-- 0102 — Current competitor prices (latest observation per product).
--
-- TWO problems, one cause: the Market screen loaded the ENTIRE competitor
-- price log and treated all of it as current.
--
-- 1. SIZE. The log only grows — every time Ali records a rival's shelf price,
--    another row joins the download. ~380 bytes a row, so roughly 470 kB at
--    five years of price checking, fetched every time Market opens.
--
-- 2. CORRECTNESS — the more serious one. "Cheapest logged competitor" was a
--    MIN across all history, with no recency limit. It drives the gap %, the
--    "priced above competitors" alert, and the Price Book "vs Rivals" lens.
--    Once the log spans years, a price someone charged in 2026 still counts as
--    today's cheapest rival, and Ali gets told to drop his price to match a
--    number nobody charges any more. Right now every product has exactly one
--    observation, so the bug is invisible — which is precisely why it's worth
--    fixing before it isn't.
--
-- Competitive price monitoring compares CURRENT shelf prices; older readings
-- are history, not current state. So: the latest observation per competitor,
-- per variant, per pack configuration.
--
-- Why the key includes price_basis and their_pcs_per_pack: one rival can
-- genuinely stock the same variant in two pack sizes at two prices. Keying on
-- (competitor, variant) alone would silently hide one of them. Keying on the
-- pack configuration too collapses only true repeat observations of the same
-- item.
--
-- The full log is retained and untouched — nothing is deleted, and history is
-- still there for anything that wants it later.

create or replace view public.v_competitor_prices_current
with (security_invoker = on)   -- RLS on competitor_prices keeps applying
as
select distinct on (cp.competitor_id, cp.variant_id, cp.price_basis, cp.their_pcs_per_pack)
  cp.id,
  cp.competitor_id,
  cp.variant_id,
  cp.their_pcs_per_pack,
  cp.their_unit_size,
  cp.their_unit_uom,
  cp.price_mvr,
  cp.price_basis,
  cp.observed_date,
  cp.notes,
  cp.created_at
from public.competitor_prices cp
order by
  cp.competitor_id, cp.variant_id, cp.price_basis, cp.their_pcs_per_pack,
  cp.observed_date desc, cp.created_at desc;

comment on view public.v_competitor_prices_current is
  'Latest competitor observation per (competitor, variant, price basis, pack size). '
  'Market compares against CURRENT rival prices; the full competitor_prices log '
  'is retained untouched for history.';

-- Supports the DISTINCT ON ordering above.
create index if not exists idx_competitor_prices_latest
  on public.competitor_prices
     (competitor_id, variant_id, price_basis, their_pcs_per_pack, observed_date desc, created_at desc);

revoke all on public.v_competitor_prices_current from public, anon;
grant select on public.v_competitor_prices_current to authenticated, service_role;
