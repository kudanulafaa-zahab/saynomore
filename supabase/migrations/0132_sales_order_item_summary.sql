-- 0132 — A one-line, human summary of what an order contains.
--
-- The Sales list showed only a customer name (truncated to 1-2 characters by
-- the order number sitting on the same line) and a total. Ali's point: you
-- never scan that list for "SO-2026-080", you scan it for who and what. The
-- card needs "Xtra Kering XXL — 2 packs (34 pcs)".
--
-- Built here rather than in the browser for three reasons: the list is
-- keyset-paginated so the client would need a second round-trip per page;
-- the phrasing depends on pack/carton configuration that already lives here;
-- and unit conversion is stock math, which by this project's first rule does
-- not happen in TypeScript.
--
-- Mixed cartons get their own shape. A Sosoft order is five separate lines
-- (Red, Purple, Blue, Pink, Green) that are all one physical carton, so
-- listing them individually would push a single order to half a screen.
-- They collapse to "Sosoft mixed carton — 6 bottles (Red 1 · Purple 1 · …)".

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
      s.packs_per_carton
    from sales_order_lines sol
    join skus s            on s.id = sol.sku_id
    join variants v        on v.id = s.variant_id
    join product_models m  on m.id = v.model_id
    join brands b          on b.id = m.brand_id
    where sol.order_id = p_order_id
  ),
  agg as (
    select
      count(*)                                   as n,
      bool_and(l.is_mixed_carton_fill)           as all_mixed,
      count(distinct l.brand)                    as brands,
      sum(l.qty_pieces)                          as pieces,
      min(l.brand)                               as one_brand
    from l
  ),
  -- The single most valuable line, used both for one-line orders and as the
  -- headline of a multi-product order.
  top_line as (
    select
      l.*,
      -- "2" not "2.000"; "1.5" stays "1.5" for a genuine half quantity.
      trim(trailing '.' from trim(trailing '0' from l.qty::text)) as qty_txt
    from l
    order by l.line_total_mvr desc, l.model, l.variant
    limit 1
  )
  select case
    -- Nothing on the order yet.
    when (select n from agg) = 0 then null

    -- One physical mixed carton, however many scents are in it.
    when (select all_mixed from agg) and (select n from agg) > 1 and (select brands from agg) = 1 then
      (select one_brand from agg) || ' mixed carton — ' || (select pieces from agg) || ' bottles ('
      || (select string_agg(x.model || ' ' || x.q, ' · ' order by x.qty_pieces desc, x.model)
          from (select l.model, l.qty_pieces,
                       trim(trailing '.' from trim(trailing '0' from l.qty::text)) as q
                from l) x)
      || ')'

    -- Everything else leads with the biggest line, and says how many others.
    else
      (select
         btrim(t.model || ' ' || t.variant) || ' — ' ||
         case t.uom
           when 'carton' then
             t.qty_txt || ' carton' || case when t.qty = 1 then '' else 's' end
             || ' (' || t.packs_per_carton || '×' || t.pcs_per_pack
             || ' = ' || t.qty_pieces || ' pcs)'
           when 'pack' then
             t.qty_txt || ' pack' || case when t.qty = 1 then '' else 's' end
             || ' (' || t.pcs_per_pack || ' pcs)'
           else
             t.qty_pieces || ' pc' || case when t.qty_pieces = 1 then '' else 's' end
         end
         || case when (select n from agg) > 1
                 then '  +' || ((select n from agg) - 1) || ' more'
                 else '' end
       from top_line t)
  end;
$function$;

comment on function public.sales_order_item_summary(uuid) is
  'One-line plain-English description of an order''s contents for the Sales '
  'list. Mixed cartons collapse to a single line with the scent split.';

revoke execute on function public.sales_order_item_summary(uuid) from public, anon;
grant  execute on function public.sales_order_item_summary(uuid) to authenticated, service_role;

-- Adding an OUT column changes the return row type, which CREATE OR REPLACE
-- cannot do — drop first (same reason migration 0117 had to).
drop function if exists public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int);

create function public.get_sales_orders(
  p_status            text        default null,
  p_search            text        default null,
  p_unpaid            boolean     default false,
  p_customer_id       uuid        default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 30
)
returns table (
  id                     uuid,
  order_number           text,
  customer_id            uuid,
  status                 text,
  channel                text,
  payment_status         text,
  payment_method         text,
  payment_proof_url      text,
  source_godown_id       uuid,
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_island        text,
  delivery_to_boat       boolean,
  assigned_driver_id     uuid,
  picked_at              timestamptz,
  delivered_at           timestamptz,
  cash_collected_mvr     numeric,
  cash_deposited_at      timestamptz,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz,
  updated_at             timestamptz,
  order_total_mvr        numeric,
  items_summary          text,
  balance_mvr            numeric
)
-- SECURITY INVOKER, unchanged: sales_orders is RLS-protected and a staff
-- driver must keep seeing only their own assigned runs.
language sql
stable
set search_path = public
as $$
  select
    o.id, o.order_number, o.customer_id, o.status, o.channel,
    o.payment_status, o.payment_method, o.payment_proof_url,
    o.source_godown_id, o.delivery_address_line1, o.delivery_address_line2,
    o.delivery_island, o.delivery_to_boat, o.assigned_driver_id,
    o.picked_at, o.delivered_at, o.cash_collected_mvr, o.cash_deposited_at,
    o.notes, o.created_by, o.created_at, o.updated_at,
    coalesce((select sum(l.line_total_mvr)
                from sales_order_lines l
               where l.order_id = o.id), 0)::numeric as order_total_mvr,
    sales_order_item_summary(o.id) as items_summary,
    -- Still owed, net of payments AND returned goods — the same definition
    -- get_receivables_aging uses, so the list can show "Owes X" without the
    -- browser ever computing it.
    round(
      coalesce((select sum(l.line_total_mvr) from sales_order_lines l where l.order_id = o.id), 0)
      - coalesce((select sum(p.amount_mvr) from order_payments p where p.order_id = o.id), 0)
      - coalesce((select sum(r.refund_amount_mvr) from sales_returns r where r.order_id = o.id), 0)
    , 2) as balance_mvr
  from sales_orders o
  left join customers c on c.id = o.customer_id
  where
    (p_status is null or p_status = 'all' or o.status = p_status)
    and (p_customer_id is null or o.customer_id = p_customer_id)
    and (not p_unpaid or (
          o.status not in ('draft', 'cancelled')
          and o.payment_status in ('pending', 'partial')))
    and (
      p_search is null or btrim(p_search) = ''
      or o.order_number  ilike '%' || btrim(p_search) || '%'
      or c.name          ilike '%' || btrim(p_search) || '%'
      or c.phone         ilike '%' || btrim(p_search) || '%'
    )
    and (
      p_cursor_created_at is null
      or (o.created_at, o.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by o.created_at desc, o.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

revoke execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int) from public, anon;
grant  execute on function public.get_sales_orders(text, text, boolean, uuid, timestamptz, uuid, int) to authenticated, service_role;
