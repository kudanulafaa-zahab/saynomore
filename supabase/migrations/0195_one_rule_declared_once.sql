-- 0195 — one rule, declared once.
--
-- Found while writing 0194's ledger self-check: six CHECK constraints exist
-- TWICE on the same table, with byte-identical definitions.
--
--   sales_order_lines   line_total_mvr >= 0        (auto-named + sol_total_nonneg)
--   sales_order_lines   qty_pieces > 0             (auto-named + sol_qty_positive)
--   sales_order_lines   unit_price_mvr >= 0        (auto-named + sol_price_nonneg)
--   shipment_lines      qty_cartons > 0            (auto-named + sl_qty_positive)
--   shipment_lines      fob_per_carton >= 0        (auto-named + sl_fob_nonneg)
--   shipment_lines      qty_cartons_actual >= 0    (auto-named + sl_qty_actual_nonneg)
--
-- Each pair is one constraint from the original CREATE TABLE (declared inline on
-- the column, so Postgres named it) and one from a later hardening migration
-- that added rules already present. Both are evaluated on every insert and
-- update of two of the busiest tables in the app.
--
-- BE HONEST ABOUT THE SIZE OF THIS. It is not a speed fix. Six extra integer
-- comparisons on a table with 211 rows is unmeasurable, and claiming otherwise
-- would be the kind of "optimisation" that is really just churn. What it buys
-- is clarity: when a write is refused, exactly one rule can be named as the one
-- that refused it, and anyone reading the schema sees each rule stated once.
--
-- The AUTO-NAMED half goes and the hand-named half stays. The hand-named ones
-- are explicitly written in a migration, so dropping those would erase the
-- visible intent; the auto-named ones exist only as a side effect of an inline
-- column check and appear by name in no file at all. Nothing in the app
-- references either name — checked before writing this.
--
-- A replay from empty still creates the auto-named ones at 0002 and drops them
-- here, which is correct and idempotent: `if exists` means running this twice,
-- or against a database that never had them, does nothing.

alter table public.sales_order_lines drop constraint if exists sales_order_lines_line_total_mvr_check;
alter table public.sales_order_lines drop constraint if exists sales_order_lines_qty_pieces_check;
alter table public.sales_order_lines drop constraint if exists sales_order_lines_unit_price_mvr_check;

alter table public.shipment_lines drop constraint if exists shipment_lines_qty_cartons_check;
alter table public.shipment_lines drop constraint if exists shipment_lines_fob_per_carton_check;
alter table public.shipment_lines drop constraint if exists shipment_lines_qty_cartons_actual_check;

-- The surviving rules, restated here so this migration is readable on its own
-- and so a future reader can confirm nothing was actually given up:
--   sol_total_nonneg        line_total_mvr    >= 0
--   sol_qty_positive        qty_pieces        >  0
--   sol_price_nonneg        unit_price_mvr    >= 0
--   sl_qty_positive         qty_cartons       >  0
--   sl_fob_nonneg           fob_per_carton    >= 0
--   sl_qty_actual_nonneg    qty_cartons_actual is null or >= 0
