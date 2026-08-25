-- 0211 — a clearance offer knows who it is for, and what the thing is called.
--
-- ── THE STATE OF THE BUSINESS THAT PROMPTED THIS ────────────────────────────
--
-- The Promo Advisor lists 12 products with MVR 32,487 of money standing still,
-- and every row carries a "Copy post" button that writes a caption Ali pastes
-- on Facebook, Instagram or Viber. Read against the catalogue, SEVEN OF THE
-- TWELVE are lines he has discontinued:
--
--     Royal Soft Boy XL / XXL, Royal Soft Girl L / M / XL, Skin Comfort M / XXL
--
-- CLAUDE.md, on the four dropped lines, could not be plainer:
--
--     "Paid advertising, education messages and anything aimed at winning a
--      NEW customer must never feature a line that will not be restocked —
--      winning someone for a product about to vanish is worse than not winning
--      them. But a clearance offer to EXISTING customers is exactly right."
--
-- Both halves are true of the same product at the same moment, and the only
-- thing that separates them is WHO IS BEING SPOKEN TO. A public post is
-- acquisition. So the Promo Advisor was right to list them and wrong about the
-- channel — and it could not have been otherwise, because this function never
-- told the screen which rows were discontinued. There was nothing to be right
-- with.
--
-- ── AND TWO WORDS THAT WERE WRONG IN PUBLIC ─────────────────────────────────
--
-- The caption is the most public text this app produces, and CLAUDE.md's units
-- rule covers "anything pasted into a message". It said:
--
--   "1 pieces in every pack."   for the three products whose pack IS one item
--                               (Mama Lime, Dewberry, Strawberry). A piece
--                               count, and not even grammatical.
--   "MVR 137/pack"              for a Body Shop TUB. `/pack` was a literal, and
--                               a tub is never a pack.
--
-- Both are fixed by giving the screen the product's own noun, which Postgres
-- has had since 0143. Nothing here changes a price or a rule about one; the
-- numbers are the same numbers.

-- DROPPED, NOT REPLACED. Two columns are being ADDED to the returned row, and
-- Postgres refuses `create or replace` when the OUT parameters change shape
-- ("cannot change return type of existing function"). Safe here: the body is a
-- quoted string rather than the new standard-SQL form, so no other function
-- holds a hard dependency on it — `get_today` names it at call time.
drop function if exists public.get_promo_suggestions();

create or replace function public.get_promo_suggestions()
returns table (
  sku_id            uuid,
  internal_code     text,
  full_path         text,
  stock_pieces      integer,
  stock_value_mvr   numeric,
  days_of_stock     integer,
  expiry_days_left  integer,
  current_pack_mvr  numeric,
  promo_pack_mvr    numeric,
  discount_pct      numeric,
  pcs_per_pack      integer,
  reason            text,
  -- NEW. Which of the two clearance jobs this row is.
  discontinued      boolean,
  -- NEW. What one of them is CALLED — "tub", "bottle", "pack". The caption had
  -- the word "pack" as a literal, so a tub of body butter was advertised by the
  -- pack. `unit_noun` is the same source `qty_in_trade_units` uses (0143), so
  -- this is the screen agreeing with the ledger rather than a second opinion.
  unit_noun         text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with stock as (
    select bs.sku_id,
           sum(bs.qty_pieces_remaining)::integer as pieces,
           round(sum(bs.qty_pieces_remaining * coalesce(bs.landed_per_piece_mvr, 0)), 2) as value_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    group by bs.sku_id
  ),
  latest_landed as (
    select distinct on (bs.sku_id) bs.sku_id, bs.landed_per_piece_mvr
    from v_batch_stock bs
    where bs.qty_pieces_remaining > 0
    order by bs.sku_id, bs.received_at desc
  ),
  velocity as (
    select sol.sku_id, sum(sol.qty_pieces)::numeric / 90.0 as per_day
    from sales_order_lines sol
    join sales_orders so on so.id = sol.order_id
    where so.status not in ('draft', 'cancelled')
      and (so.created_at at time zone 'Indian/Maldives')::date
          >= (now() at time zone 'Indian/Maldives')::date - 90
    group by sol.sku_id
  ),
  expiring as (
    select es.sku_id, min(es.days_left)::integer as days_left
    from v_expiring_stock es
    group by es.sku_id
  ),
  scored as (
    select
      s.id                as k_sku_id,
      s.internal_code     as k_internal_code,
      concat_ws(' › ', b.name, m.name, v.display_name) as k_full_path,
      st.pieces           as k_pieces,
      st.value_mvr        as k_value_mvr,
      case when coalesce(vel.per_day, 0) > 0
           then round(st.pieces / vel.per_day)::integer end as k_days_of_stock,
      ex.days_left        as k_expiry_days_left,
      vs.selling_price_per_pack_mvr as k_current_pack_mvr,
      round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0) as k_promo_pack_mvr,
      round((1 - (ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90)
                / nullif(vs.selling_price_per_pack_mvr, 0)) * 100, 0) as k_discount_pct,
      s.pcs_per_pack      as k_pcs_per_pack,
      case
        when ex.days_left is not null and ex.days_left <= 180 then 'expiring'
        when coalesce(vel.per_day, 0) = 0                     then 'dead'
        when st.pieces / vel.per_day > 365                    then 'stagnant'
      end as k_reason,
      -- DISCONTINUED IS NOT INACTIVE (0180). These stay sellable, priced and
      -- counted; the only thing that changes is that they are never reordered
      -- and never advertised to strangers. So they belong on this list — they
      -- are exactly the stock most worth clearing — and the row has to say so.
      (m.discontinued_at is not null) as k_discontinued,
      unit_noun(pc.unit_uom) as k_unit_noun
    from skus s
    join stock st            on st.sku_id = s.id
    join latest_landed ll    on ll.sku_id = s.id
    join v_skus vs           on vs.id = s.id
    left join velocity vel   on vel.sku_id = s.id
    left join expiring ex    on ex.sku_id = s.id
    join variants v          on v.id = s.variant_id
    join product_models m    on m.id = v.model_id
    join brands b            on b.id = m.brand_id
    join product_categories pc on pc.id = m.category_id
    where s.is_active
      and vs.selling_price_per_pack_mvr is not null
      and vs.selling_price_per_pack_mvr > 0
      and round(ll.landed_per_piece_mvr * s.pcs_per_pack / 0.90, 0)
          < vs.selling_price_per_pack_mvr
  )
  select sc.k_sku_id, sc.k_internal_code, sc.k_full_path, sc.k_pieces,
         sc.k_value_mvr, sc.k_days_of_stock, sc.k_expiry_days_left,
         sc.k_current_pack_mvr, sc.k_promo_pack_mvr, sc.k_discount_pct,
         sc.k_pcs_per_pack, sc.k_reason, sc.k_discontinued, sc.k_unit_noun
  from scored sc
  where sc.k_reason is not null
  order by
    case sc.k_reason when 'expiring' then 0 when 'dead' then 1 else 2 end,
    sc.k_value_mvr desc;
$function$;

revoke execute on function public.get_promo_suggestions() from public, anon;
grant  execute on function public.get_promo_suggestions() to authenticated, service_role;

-- ── PROVE IT LANDED ─────────────────────────────────────────────────────────
do $$
declare
  v_anon boolean;
  v_src  text := pg_get_functiondef('public.get_promo_suggestions()'::regprocedure);
begin
  if v_src !~ 'k_discontinued' then
    raise exception 'the promo list still cannot tell a dropped line from a kept one';
  end if;
  if v_src !~ 'unit_noun' then
    raise exception 'the promo list still has no word for one of the thing';
  end if;

  select has_function_privilege('anon', 'public.get_promo_suggestions()', 'execute') into v_anon;
  if v_anon then raise exception 'anon can execute get_promo_suggestions'; end if;
end $$;
