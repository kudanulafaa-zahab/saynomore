-- 0143 — Stop printing piece counts at the user.
--
-- Ali, three times, most recently 2026-08-05: "Who sells diapers lose as
-- pieces? Always sell in packs and cartons!" CLAUDE.md now carries it as a
-- permanent rule — say "1 carton (4 packs of 48)", never "192 pcs".
--
-- The rule was written, and then the two functions that feed the most-read
-- text in the app kept breaking it:
--
--   * sales_order_item_summary (0132) — the one line under every card in the
--     Sales list — rendered "2 cartons (3×34 = 102 pcs)" and "2 packs (34
--     pcs)". Pack SIZE is kept (a 34s and a 48s are different products), but
--     the piece TOTAL is exactly the number Ali says nobody in this trade
--     quotes.
--   * get_sales_order_delete_impact (0133) — the delete confirmation — handed
--     the screen a bare `pieces_restored` integer, which it printed as
--     "128 pcs" because there was nothing else to print.
--
-- Both now speak packs and cartons. Pieces stay in the database, where they
-- belong: the stock ledger, landed cost, competitor comparison, mixed cartons.

-- ── One phrasing helper, used by everything below ─────────────────────────
-- The Postgres twin of formatQtyInTradeUnits in lib/trade-units.ts. It exists
-- here because unit conversion is stock math (hard rule 1) and because the
-- Sales list is keyset-paginated — phrasing it in the browser would cost a
-- round-trip per page.

create or replace function public.unit_noun(p_unit_uom text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_unit_uom when 'ml' then 'bottle' when 'g' then 'pouch' else 'pack' end;
$function$;

comment on function public.unit_noun(text) is
  'What one "pack"-level unit is called for a category: a Sosoft 500ml is a '
  'bottle, not a pack.';

-- Pure string formatters that read no tables, but the standing rule is that
-- nothing new is left anon-executable by the default PUBLIC grant.
revoke execute on function public.unit_noun(text) from public, anon;
grant  execute on function public.unit_noun(text) to authenticated, service_role;

create or replace function public.qty_in_trade_units(
  p_pieces          numeric,
  p_pcs_per_pack    integer,
  p_packs_per_carton integer,
  p_unit_uom        text,
  p_sellable_units  text[]
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_su       text[] := coalesce(p_sellable_units, array['pack','carton']);
  v_noun     text   := public.unit_noun(p_unit_uom);
  v_per_ctn  integer := coalesce(p_pcs_per_pack, 0) * coalesce(p_packs_per_carton, 0);
  v_ctns     integer;
  v_rem      numeric;
  v_packs    integer;
  v_parts    text[] := '{}';
begin
  if p_pieces is null or p_pieces <= 0 then
    return '0';
  end if;

  if 'carton' = any(v_su) and v_per_ctn > 0 then
    v_ctns := floor(p_pieces / v_per_ctn);
    v_rem  := p_pieces - (v_ctns::numeric * v_per_ctn);
    if v_ctns > 0 then
      v_parts := v_parts || (v_ctns || ' carton' || case when v_ctns = 1 then '' else 's' end);
    end if;
    if 'pack' = any(v_su) and coalesce(p_pcs_per_pack, 0) > 0 and v_rem > 0 then
      v_packs := floor(v_rem / p_pcs_per_pack);
      if v_packs > 0 then
        v_parts := v_parts || (v_packs || ' ' || v_noun || case when v_packs = 1 then '' else 's' end);
      end if;
    end if;
    -- A carton-only SKU with a part-carton remainder: say so as a fraction of
    -- a carton rather than silently dropping it or inventing a pack tier.
    if not ('pack' = any(v_su)) and v_rem > 0 then
      -- pcs_per_pack = 1 means the loose unit IS the noun (Sosoft bottles).
      if coalesce(p_pcs_per_pack, 0) = 1 then
        v_parts := v_parts || (v_rem || ' ' || v_noun || case when v_rem = 1 then '' else 's' end);
      else
        v_parts := v_parts || (round((v_rem / v_per_ctn) * 100) || '% carton');
      end if;
    end if;
    if array_length(v_parts, 1) > 0 then
      return array_to_string(v_parts, ' + ');
    end if;
    return 'under 1 carton';
  end if;

  if 'pack' = any(v_su) and coalesce(p_pcs_per_pack, 0) > 0 then
    v_packs := floor(p_pieces / p_pcs_per_pack);
    if v_packs > 0 then
      return v_packs || ' ' || v_noun || case when v_packs = 1 then '' else 's' end;
    end if;
    return 'under 1 ' || v_noun;
  end if;

  -- No pack configuration to convert with. Every SKU has one today; this is
  -- the honest fallback rather than a fabricated pack count.
  return p_pieces || ' ' || v_noun || case when p_pieces = 1 then '' else 's' end;
end;
$function$;

comment on function public.qty_in_trade_units(numeric, integer, integer, text, text[]) is
  'A piece count spoken in the units the SKU actually trades in — "2 cartons '
  '+ 1 pack", "6 bottles". Postgres twin of formatQtyInTradeUnits.';

revoke execute on function public.qty_in_trade_units(numeric, integer, integer, text, text[]) from public, anon;
grant  execute on function public.qty_in_trade_units(numeric, integer, integer, text, text[]) to authenticated, service_role;

-- ── The Sales list line ───────────────────────────────────────────────────

create or replace function public.sales_order_item_summary(p_order_id uuid)
returns text
language sql
stable
set search_path to 'public'
as $function$
  with l as (
    select
      sol.uom,
      sol.qty,
      sol.qty_pieces,
      sol.line_total_mvr,
      sol.is_mixed_carton_fill,
      b.name  as brand,
      m.name  as model,
      v.display_name as variant,
      s.pcs_per_pack,
      s.packs_per_carton,
      public.unit_noun(pc.unit_uom) as noun
    from sales_order_lines sol
    join skus s               on s.id = sol.sku_id
    join variants v           on v.id = s.variant_id
    join product_models m     on m.id = v.model_id
    join brands b             on b.id = m.brand_id
    join product_categories pc on pc.id = m.category_id
    where sol.order_id = p_order_id
  ),
  agg as (
    select
      count(*)                                   as n,
      bool_and(l.is_mixed_carton_fill)           as all_mixed,
      count(distinct l.brand)                    as brands,
      sum(l.qty_pieces)                          as pieces,
      min(l.brand)                               as one_brand,
      min(l.noun)                                as one_noun
    from l
  ),
  top_line as (
    select
      l.*,
      trim(trailing '.' from trim(trailing '0' from l.qty::text)) as qty_txt
    from l
    order by l.line_total_mvr desc, l.model, l.variant
    limit 1
  )
  select case
    when (select n from agg) = 0 then null

    -- One physical mixed carton, however many scents are in it. The count
    -- here is bottles, which IS the trade unit for these — not pieces.
    when (select all_mixed from agg) and (select n from agg) > 1 and (select brands from agg) = 1 then
      (select one_brand from agg) || ' mixed carton — ' || (select pieces from agg) || ' '
      || (select one_noun from agg) || 's ('
      || (select string_agg(x.model || ' ' || x.q, ' · ' order by x.qty_pieces desc, x.model)
          from (select l.model, l.qty_pieces,
                       trim(trailing '.' from trim(trailing '0' from l.qty::text)) as q
                from l) x)
      || ')'

    else
      (select
         btrim(t.model || ' ' || t.variant) || ' — ' ||
         case t.uom
           when 'carton' then
             -- "2 cartons (3 packs of 34)". The pack SIZE stays because that
             -- is how a diaper variant is identified; the piece TOTAL goes.
             t.qty_txt || ' carton' || case when t.qty = 1 then '' else 's' end
             || ' (' || t.packs_per_carton || ' ' || t.noun
             || case when t.packs_per_carton = 1 then '' else 's' end
             || case when t.pcs_per_pack > 1 then ' of ' || t.pcs_per_pack else '' end || ')'
           when 'pack' then
             t.qty_txt || ' ' || t.noun || case when t.qty = 1 then '' else 's' end
             || case when t.pcs_per_pack > 1 then ' of ' || t.pcs_per_pack else '' end
           else
             -- Loose tier. For a 1-per-pack product that is a bottle, not a
             -- "piece"; there is no diaper SKU that reaches this branch.
             t.qty_pieces || ' '
             || case when t.pcs_per_pack = 1 then t.noun else 'piece' end
             || case when t.qty_pieces = 1 then '' else 's' end
         end
         || case when (select n from agg) > 1
                 then '  +' || ((select n from agg) - 1) || ' more'
                 else '' end
       from top_line t)
  end;
$function$;

comment on function public.sales_order_item_summary(uuid) is
  'One-line plain-English description of an order''s contents for the Sales '
  'list, in packs and cartons — never a piece count. Mixed cartons collapse '
  'to a single line with the scent split.';

revoke execute on function public.sales_order_item_summary(uuid) from public, anon;
grant  execute on function public.sales_order_item_summary(uuid) to authenticated, service_role;

-- ── The delete confirmation ───────────────────────────────────────────────
-- Adding an OUT column changes the return row type, so this has to be dropped
-- and recreated (same reason 0132 had to).

drop function if exists public.get_sales_order_delete_impact(uuid);

create function public.get_sales_order_delete_impact(p_order_id uuid)
returns table (
  order_number           text,
  customer_name          text,
  status                 text,
  total_mvr              numeric,
  paid_mvr               numeric,
  balance_mvr            numeric,
  line_count             integer,
  pieces_restored        integer,
  -- What that piece count means in the warehouse, per product, in cartons and
  -- packs. `pieces_restored` stays for the "is there any stock at all" test;
  -- this is what the sheet prints.
  stock_restored_summary text,
  blocked_reason         text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_order sales_orders%ROWTYPE;
  v_paid  numeric;
begin
  if not coalesce(is_admin_or_manager(), false) then
    raise exception 'Only a manager or admin can preview an order delete';
  end if;

  select * into v_order from sales_orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  select coalesce(sum(op.amount_mvr), 0) into v_paid
  from order_payments op where op.order_id = p_order_id;

  return query
  with restored as (
    select
      sm.sku_id,
      sum(sm.qty_pieces) as pieces,
      m.name  as model,
      v.display_name as variant,
      s.pcs_per_pack,
      s.packs_per_carton,
      s.sellable_units,
      pc.unit_uom
    from stock_movements sm
    join skus s                on s.id = sm.sku_id
    join variants v            on v.id = s.variant_id
    join product_models m      on m.id = v.model_id
    join product_categories pc on pc.id = m.category_id
    where sm.source_type   = 'sales_order'
      and sm.source_id     = p_order_id
      and sm.movement_type = 'out'
    group by sm.sku_id, m.name, v.display_name, s.pcs_per_pack,
             s.packs_per_carton, s.sellable_units, pc.unit_uom
  )
  select
    v_order.order_number,
    (select c.name from customers c where c.id = v_order.customer_id),
    v_order.status,
    round(coalesce((select sum(sol.line_total_mvr) from sales_order_lines sol
                     where sol.order_id = p_order_id), 0), 2)::numeric,
    round(v_paid, 2),
    round(
      coalesce((select sum(sol.line_total_mvr) from sales_order_lines sol
                 where sol.order_id = p_order_id), 0)
      - v_paid
      - coalesce((select sum(sr.refund_amount_mvr) from sales_returns sr
                   where sr.order_id = p_order_id), 0)
    , 2),
    coalesce((select count(*)::integer from sales_order_lines sol
               where sol.order_id = p_order_id), 0),
    coalesce((select sum(r.pieces)::integer from restored r), 0),
    (select string_agg(
        public.qty_in_trade_units(r.pieces, r.pcs_per_pack, r.packs_per_carton,
                                  r.unit_uom, r.sellable_units)
        || ' ' || btrim(r.model || ' ' || r.variant),
        ' · ' order by r.pieces desc)
     from restored r),
    -- Mirrors, in order, every RAISE in delete_sales_order.
    case
      when v_order.payment_status in ('paid', 'deposited') then
        'This order is already settled. Void it and issue a credit note instead of deleting it.'
      when coalesce(v_order.cash_collected_mvr, 0) > 0 then
        'Cash has been collected against this order. Void it instead of deleting it.'
      when v_paid > 0 then
        'A payment has been recorded against this order. Void it instead of deleting it.'
      else null
    end;
end;
$function$;

comment on function public.get_sales_order_delete_impact(uuid) is
  'Figures shown in the order-delete confirmation, plus the reason the delete '
  'would be refused. Mirrors the guards in delete_sales_order — change both '
  'together. Stock is described in cartons and packs, never pieces.';

revoke execute on function public.get_sales_order_delete_impact(uuid) from public, anon;
grant  execute on function public.get_sales_order_delete_impact(uuid) to authenticated, service_role;
