-- The P&L and the Reports tab must tell the same story about the same month.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────
--
-- Revenue and COGS are computed TWICE, by two functions, from the same rows:
--
--   get_pnl            the Financials screen  — one row for the period
--   get_reports_data   the Reports screen     — one row per SKU
--
-- Nothing has ever asserted they agree. The Product Card's own source comment
-- flags the risk in as many words: "they are separate functions and could
-- drift apart in a future migration". Four tests exercise get_pnl; none
-- exercises get_reports_data; none compares them.
--
-- Ali reads both screens. If they disagree he has two truths for one month and
-- no way to tell which is the real one.
--
-- ── WHAT WAS MEASURED ON PRODUCTION, 2026-09-13 ───────────────────────────
--
-- Checked across four windows. Over the full year they agree exactly:
--
--     2026-01-01..12-31   revenue 90,049.96 = 90,049.96
--                         cogs    58,996.73 = 58,996.73
--
-- but over SEPTEMBER ALONE the COGS differ by one laari:
--
--     2026-09-01..09-30   cogs    12,111.35  vs  12,111.34
--
-- That is not a logic error, and the year agreeing is what hides it — the
-- per-SKU differences cancel over a long enough window. The cause is that the
-- two functions round at DIFFERENT POINTS:
--
--   get_pnl           sums qty_pieces * cost_per_piece over every line and
--                     rounds ONCE            (0123: round(s.cogs, 2))
--   get_reports_data  sums per SKU and rounds EACH SKU
--                     (0123: round(coalesce(ps.cogs_mvr, 0), 2)),
--                     and the screen adds those already-rounded rows up.
--
-- So the gap is bounded by half a laari per SKU in the window, and it is a
-- DISPLAY-rounding artefact rather than a disagreement about the money.
--
-- ── WHAT THIS TEST ASSERTS, AND WHY NOT EXACT EQUALITY ────────────────────
--
-- Exact equality would be the wrong assertion: it would be asserting that the
-- rounding happens to cancel, which is luck, not a rule — and a test that
-- passes by luck fails later for a reason nobody can explain (Seat 9).
--
-- The RULE is that the two functions describe the same money, so the only
-- thing that may separate them is per-SKU rounding. That bound is computed
-- from the data rather than hardcoded, so the test stays honest as the
-- catalogue grows.
--
-- Revenue is asserted EXACTLY: it is summed from line totals, which are
-- already stored rounded, so no rounding is introduced by either function and
-- any difference there would be a genuine defect.
--
-- NOTE FOR WHOEVER READS THIS NEXT: forcing the two to agree to the cent is a
-- real option — get_pnl would sum the per-SKU rounded parts instead of
-- rounding once. It was deliberately NOT done here because it changes a
-- headline money figure Ali reads, and that is his call, not mine.

begin;
select plan(6);

-- Windows chosen to be awkward on purpose: the whole dataset, a single month,
-- and a window with no sales at all (where both must say zero rather than
-- null, because a screen renders "—" for null and "MVR 0" for zero).
create temporary table windows(lo date, hi date, label text) on commit drop;
insert into windows values
  ('2000-01-01','2100-01-01','everything'),
  (date_trunc('month', now())::date, (date_trunc('month', now()) + interval '1 month - 1 day')::date, 'this month'),
  ('2100-01-01','2100-01-02','a window with nothing in it');

create temporary view cmp as
select w.label,
       round(p.revenue_mvr, 2)                as pnl_rev,
       round(coalesce(r.rev, 0), 2)           as rep_rev,
       round(p.cogs_mvr, 2)                   as pnl_cogs,
       round(coalesce(r.cogs, 0), 2)          as rep_cogs,
       coalesce(r.skus, 0)                    as skus
  from windows w
  cross join lateral get_pnl(w.lo, w.hi) p
  left join lateral (
    select sum(total_revenue_mvr) as rev,
           sum(total_landed_cost_mvr) as cogs,
           count(*) as skus
      from get_reports_data(w.lo, w.hi)
  ) r on true;

-- 1-3. Revenue is summed from stored line totals by both, so it must be exact.
select is(
  (select count(*) from cmp where pnl_rev is distinct from rep_rev)::int, 0,
  'revenue agrees EXACTLY between the P&L and Reports, in every window'
);

-- COGS may differ only by per-SKU display rounding: at most half a laari per
-- SKU, plus one laari for the P&L''s own single rounding.
select is(
  (select count(*) from cmp
    where abs(pnl_cogs - rep_cogs) > (skus * 0.005 + 0.01))::int, 0,
  'COGS agrees within the per-SKU rounding bound, in every window'
);

-- And the gap must never be LARGE, whatever the SKU count — a real drift would
-- show up as rufiyaa, not laari. This is the assertion that actually fails if
-- one of the two functions starts counting different rows.
select is(
  (select count(*) from cmp where abs(pnl_cogs - rep_cogs) > 1.00)::int, 0,
  'COGS never differs by as much as a rufiyaa'
);

-- An empty window is zero on both sides, not null. A screen renders null as
-- "—", which reads as "not known" rather than "nothing sold".
select is(
  (select pnl_rev from cmp where label = 'a window with nothing in it'), 0::numeric,
  'an empty period reports zero revenue, not null'
);
select is(
  (select rep_rev from cmp where label = 'a window with nothing in it'), 0::numeric,
  'and Reports agrees that it is zero'
);

-- The identity the whole P&L rests on.
select is(
  (select count(*) from windows w
     cross join lateral get_pnl(w.lo, w.hi) p
    where round(p.gross_profit_mvr, 2)
       is distinct from round(p.revenue_mvr - p.cogs_mvr, 2))::int, 0,
  'gross profit is exactly revenue minus COGS'
);

select * from finish();
rollback;
