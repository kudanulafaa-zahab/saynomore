-- 0180 — a range can be discontinued without being dead.
--
-- Ali, 2026-08-14: "For diapers I am discontinuing mamypoko Royal soft and skin
-- comfort and only sticking to xtra kering and merries for diapers."
--
-- WHY THIS IS A COLUMN AND NOT A NOTE. The decision was written into CLAUDE.md
-- the moment he made it, and that is where the reasoning belongs — but no
-- function can read a markdown file. Until today "Royal Soft is discontinued"
-- was true only in prose, which means `get_reorder_suggestions` would have gone
-- on proposing a purchase order for it, cheerfully, forever. A business rule
-- that only exists in a document is a rule the software does not have.
--
-- AND IT IS A DATE, NOT A BOOLEAN, because Ali runs a narrow catalogue on
-- purpose and said to expect this again. A date answers "was this line still
-- being reordered when that shipment was planned?", which a boolean cannot, and
-- it makes the next range he drops a one-row UPDATE rather than a code change.
--
-- DISCONTINUED IS NOT INACTIVE. This is the whole point of the migration and
-- getting it backwards would cost real money: there are about 281 packs of the
-- four dropped lines still in the godowns (Skin Comfort ~94, the Royal Soft
-- family ~187). `skus.is_active` already exists and already hides a SKU from
-- selling — using it here would strand that stock. So exactly one thing
-- changes: the app stops proposing that he BUY them. It does not stop selling,
-- pricing, counting, costing or clearing them.
--
--   * `get_reorder_suggestions` is a purchase order. It must never propose a
--     line that will not be restocked, so it filters them out. That is the only
--     function touched.
--   * `get_sku_reorder_alerts` deliberately still reports them. He needs to see
--     that Skin Comfort XL has twelve days left in order to plan the switch,
--     and the Promo Advisor reads stock health to find slow movers — flagging
--     281 packs of dead range as worth clearing is that feature working, not
--     misfiring. Clearance to existing customers is exactly right.
--
-- THE EIGHT CUSTOMERS ARE THE URGENT PART. 14 customers have bought one of the
-- dropped lines. Six also buy X-Tra Kering or Merries and will not notice. The
-- other eight have bought NOTHING ELSE — when their line runs out there is
-- nothing in their history to bring them back, and on a ~9-day repurchase clock
-- they are simply gone, silently. `get_stranded_customers` is what makes them
-- visible, with the nearest equivalent we can actually ship.
--
-- NOTHING BELOW NAMES A PRODUCT. The four models are named once, in an UPDATE,
-- and never again. The equivalence rule is "same category, same size label, not
-- discontinued, in stock" — which is why it will keep working for a category
-- that has no sizes at all, and for whatever he imports next.
--
-- UNITS: packs throughout, converted here (CLAUDE.md — the units rule covers
-- every word Ali reads, not only screens).

alter table product_models
  add column if not exists discontinued_at date;

comment on column product_models.discontinued_at is
  'The day this range stopped being reordered. NULL means it is still bought. '
  'Discontinued is NOT inactive: existing stock stays sellable, priced and '
  'counted — only purchasing stops. Use skus.is_active to actually withdraw '
  'something from sale.';

create index if not exists product_models_live
  on product_models (category_id) where discontinued_at is null;

-- The one place a product is named. Everything else derives from the column.
update product_models m
   set discontinued_at = date '2026-08-14'
  from brands b
 where b.id = m.brand_id
   and lower(b.name) = 'mamypoko'
   and m.name in ('Royal Soft', 'Royal Soft Boy', 'Royal Soft Girl', 'Skin Comfort')
   and m.discontinued_at is null;

-- ── Purchasing stops. Nothing else does. ────────────────────────────────────
-- Same signature and same body as before, plus one filter. get_reorder_
-- suggestions is derived entirely from get_sku_reorder_alerts(), so filtering
-- here — rather than in the alerts — is what keeps stock health and the Promo
-- Advisor able to see the dropped lines and clear them.

-- The DEFAULTs are carried over deliberately: callers invoke this with no
-- arguments, and CREATE OR REPLACE cannot drop a default without a DROP first.
create or replace function get_reorder_suggestions(
  p_lead_weeks numeric default 6, p_safety_weeks numeric default 4)
returns table (
  sku_id uuid, brand_name text, model_name text, variant_display text,
  internal_code text, stock_pieces numeric, stock_cartons numeric,
  daily_avg_pieces numeric, dir numeric, cover_days numeric,
  suggested_pieces numeric, suggested_cartons integer, pcs_per_carton integer,
  revenue_per_day numeric, status text, supplier_name text, lead_days numeric,
  order_by_date date, trend text, sold_90d integer, days_unavailable_30 integer,
  demand_censored boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  WITH
  cover AS (
    SELECT (COALESCE(p_lead_weeks, 6) + COALESCE(p_safety_weeks, 4)) * 7.0 AS cover_days
  ),
  lead_hist AS (
    SELECT sl.sku_id, s.created_at, s.grn_confirmed_at, sup.name AS supplier_name,
           ROW_NUMBER() OVER (PARTITION BY sl.sku_id ORDER BY s.grn_confirmed_at DESC) AS rn
    FROM (SELECT DISTINCT shipment_id, sku_id FROM public.shipment_lines) sl
    JOIN public.shipments s ON s.id = sl.shipment_id AND s.grn_confirmed_at IS NOT NULL
    LEFT JOIN public.suppliers sup ON sup.id = s.supplier_id
  ),
  sku_lead AS (
    SELECT lh.sku_id,
           ROUND((AVG(EXTRACT(epoch FROM (lh.grn_confirmed_at - lh.created_at)) / 86400.0)
                  FILTER (WHERE lh.rn <= 3))::numeric, 0) AS lead_days,
           MAX(lh.supplier_name) FILTER (WHERE lh.rn = 1)  AS supplier_name
    FROM lead_hist lh
    GROUP BY lh.sku_id
  ),
  base AS (
    SELECT a.*, c.cover_days
    FROM public.get_sku_reorder_alerts() a
    CROSS JOIN cover c
  )
  SELECT
    b.sku_id,
    vs.brand_name,
    vs.model_name,
    vs.variant_display,
    vs.internal_code,
    b.stock_pieces,
    ROUND(b.stock_pieces / NULLIF(vs.pcs_per_carton, 0), 1),
    b.daily_avg_pieces,
    b.dir,
    b.cover_days,
    GREATEST(0, ROUND(b.daily_avg_pieces * b.cover_days - b.stock_pieces, 0)),
    CEIL(
      GREATEST(0, b.daily_avg_pieces * b.cover_days - b.stock_pieces)
      / NULLIF(vs.pcs_per_carton, 0)
    )::INTEGER,
    vs.pcs_per_carton,
    ROUND(b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0), 2),
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 'overstock'
      ELSE b.alert_level
    END,
    sl.supplier_name,
    sl.lead_days,
    CASE
      WHEN b.dir IS NOT NULL THEN GREATEST(
        (now() AT TIME ZONE 'Indian/Maldives')::date,
        (now() AT TIME ZONE 'Indian/Maldives')::date
          + (b.dir - COALESCE(sl.lead_days, COALESCE(p_lead_weeks, 6) * 7))::int
      )
    END,
    b.trend,
    b.sold_90d,
    b.days_unavailable_30,
    b.demand_censored
  FROM base b
  JOIN public.v_skus vs ON vs.id = b.sku_id
  -- The new filter, and the only change: never propose buying a dead range.
  JOIN public.skus sk           ON sk.id = b.sku_id
  JOIN public.variants v        ON v.id  = sk.variant_id
  JOIN public.product_models pm ON pm.id = v.model_id AND pm.discontinued_at IS NULL
  LEFT JOIN sku_lead sl ON sl.sku_id = b.sku_id
  ORDER BY
    CASE
      WHEN b.dir IS NOT NULL AND b.dir > 90 THEN 2
      WHEN b.alert_level = 'critical' THEN 0
      WHEN b.alert_level = 'low'      THEN 1
      ELSE 3
    END,
    (b.daily_avg_pieces * COALESCE(vs.selling_price_per_piece_mvr, 0)) DESC;
$$;

comment on function get_reorder_suggestions(numeric, numeric) is
  'What to buy. Excludes discontinued ranges — a purchase order must never '
  'propose a line that will not be restocked. Stock health (get_sku_reorder_'
  'alerts) still reports them so remaining stock can be watched and cleared.';

revoke execute on function get_reorder_suggestions(numeric, numeric) from public;
revoke execute on function get_reorder_suggestions(numeric, numeric) from anon;
grant  execute on function get_reorder_suggestions(numeric, numeric) to authenticated;

-- ── Who is about to be stranded, and what we can offer them instead ─────────

create or replace function get_stranded_customers()
returns table (
  customer_id      uuid,
  name             text,
  phone            text,
  island           text,
  last_order_on    date,
  days_since_last  integer,
  category         text,
  dropped_model    text,
  dropped_size     text,
  packs_bought     numeric,
  swap_sku_id      uuid,
  swap_label       text,
  swap_packs_avail numeric
)
language sql
stable
security definer
set search_path = ''
as $$
with lines as (
  select so.customer_id,
         (coalesce(so.delivered_at, so.created_at) at time zone 'Indian/Maldives')::date as d,
         pc.id as category_id, pc.name as category_name,
         pm.name as model_name, pm.discontinued_at,
         pm.brand_id,
         v.attributes->>'size' as size_label,
         sl.qty_pieces, s.pcs_per_pack
  from public.sales_orders so
  join public.sales_order_lines sl on sl.order_id = so.id
  join public.skus s               on s.id  = sl.sku_id
  join public.variants v           on v.id  = s.variant_id
  join public.product_models pm    on pm.id = v.model_id
  join public.product_categories pc on pc.id = pm.category_id
  where so.status in ('confirmed', 'out_for_delivery', 'delivered')
),
-- Stranded is judged PER CATEGORY, not per customer overall. Someone who buys
-- nappies we are dropping and a detergent we are keeping is still stranded on
-- nappies — the detergent will not bring them back for a nappy.
per_cat as (
  select customer_id, category_id, category_name,
         count(*) filter (where discontinued_at is null) as live_lines,
         count(*)                                        as all_lines
  from lines group by 1,2,3
),
stranded as (
  select * from per_cat where live_lines = 0 and all_lines > 0
),
-- Their most recent purchase in that dead category: the thing to replace.
last_buy as (
  select distinct on (l.customer_id, l.category_id)
         l.customer_id, l.category_id, l.d, l.model_name, l.size_label,
         l.brand_id, l.qty_pieces, l.pcs_per_pack
  from lines l
  join stranded st on st.customer_id = l.customer_id and st.category_id = l.category_id
  where l.discontinued_at is not null
  order by l.customer_id, l.category_id, l.d desc
),
-- What is left on the shelf, by SKU, in packs.
on_hand as (
  select sm.sku_id, sum(public.stock_signed_delta(sm.movement_type, sm.qty_pieces)) as pcs
  from public.stock_movements sm group by 1
),
-- The replacement rule, and it names no product: same category, same size
-- label, still being bought, and actually in stock. Same brand is preferred
-- because it is the smaller change to ask of a customer.
swap as (
  select distinct on (lb.customer_id, lb.category_id)
         lb.customer_id, lb.category_id,
         s.id as sku_id,
         b2.name || ' ' || pm2.name
           || coalesce(' ' || (v2.attributes->>'size'), '') as label,
         floor(coalesce(oh.pcs, 0) / nullif(s.pcs_per_pack, 0)) as packs_avail,
         -- Compared against the brand THEY bought, never a named one. Staying
         -- with a familiar brand is the smaller change to ask of a customer.
         (pm2.brand_id = lb.brand_id) as same_brand
  from last_buy lb
  join public.product_models pm2     on pm2.category_id = lb.category_id
                                    and pm2.discontinued_at is null
  join public.brands b2              on b2.id = pm2.brand_id
  join public.variants v2            on v2.model_id = pm2.id
                                    and v2.attributes->>'size' is not distinct from lb.size_label
  join public.skus s                 on s.variant_id = v2.id and s.is_active
  left join on_hand oh               on oh.sku_id = s.id
  where coalesce(oh.pcs, 0) >= coalesce(s.pcs_per_pack, 1)
  order by lb.customer_id, lb.category_id, same_brand desc, oh.pcs desc
)
select
  c.id, c.name, c.phone, c.island,
  lb.d,
  ((now() at time zone 'Indian/Maldives')::date - lb.d)::int,
  st.category_name,
  lb.model_name,
  lb.size_label,
  round(lb.qty_pieces::numeric / nullif(lb.pcs_per_pack, 0), 1),
  sw.sku_id,
  sw.label,
  sw.packs_avail
from stranded st
join last_buy lb on lb.customer_id = st.customer_id and lb.category_id = st.category_id
join public.customers c on c.id = st.customer_id
left join swap sw on sw.customer_id = st.customer_id and sw.category_id = st.category_id
order by ((now() at time zone 'Indian/Maldives')::date - lb.d) desc;
$$;

comment on function get_stranded_customers() is
  'Customers whose entire history in a category is ranges we have stopped '
  'buying — when their stock runs out nothing brings them back. Returns the '
  'nearest replacement we can actually ship (same category, same size, still '
  'bought, in stock), or NULL when there is none, which is itself the finding. '
  'Quantities in packs.';

revoke execute on function get_stranded_customers() from public;
revoke execute on function get_stranded_customers() from anon;
grant  execute on function get_stranded_customers() to authenticated;
