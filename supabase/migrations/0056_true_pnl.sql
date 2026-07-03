-- ── Migration 0056: a true P&L — expense categories + get_pnl() ──
--
-- Until now "Net Profit" = gross profit minus MARKETING only. Rent,
-- salaries, utilities, fuel, bank charges had nowhere to live, so the
-- headline number silently overstated real profit. This adds:
--
--  (1) expense_categories — user-editable list (seeded with the usual
--      FMCG-importer set; Ali can rename/add/retire in the UI).
--  (2) business_expenses — one row per expense: date, category, amount.
--  (3) get_pnl(p_from, p_to) — ALL period math in Postgres (hard rule #1):
--        revenue          from confirmed sales lines in period
--        cogs             from the sale-time cost snapshots (0045)
--        gross profit     revenue − cogs
--        marketing        campaign spend PRORATED BY DAY-OVERLAP with the
--                         period — previously the FULL campaign amount
--                         landed on whatever slice of it you reported on
--        other opex       business_expenses in period, per category
--        net profit       gross − marketing − other opex
--
-- RLS mirrors the app's model: everyone logged-in reads, admin/manager
-- writes. Grants follow the 0053 lockdown (authenticated only, no anon).

BEGIN;

CREATE TABLE expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_expense_categories_updated
BEFORE UPDATE ON expense_categories
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO expense_categories (name, sort_order) VALUES
  ('Rent & Godown',        10),
  ('Staff Salaries',       20),
  ('Utilities & Internet', 30),
  ('Fuel & Delivery',      40),
  ('Bank & Fees',          50),
  ('Other',                90);

CREATE TABLE business_expenses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  amount_mvr   NUMERIC(15,2) NOT NULL CHECK (amount_mvr > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description  TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_expenses_date ON business_expenses (expense_date);

CREATE TRIGGER trg_business_expenses_updated
BEFORE UPDATE ON business_expenses
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_expenses  ENABLE ROW LEVEL SECURITY;

CREATE POLICY ec_read  ON expense_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY ec_write ON expense_categories FOR ALL    USING (is_admin_or_manager());
CREATE POLICY be_read  ON business_expenses  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY be_write ON business_expenses  FOR ALL    USING (is_admin_or_manager());

-- Table grants (RLS is the row filter; grants gate the roles at all).
REVOKE ALL ON expense_categories, business_expenses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories, business_expenses TO authenticated;
GRANT ALL ON expense_categories, business_expenses TO service_role;

-- ── The P&L, computed where financial math lives: Postgres ────────────────
CREATE OR REPLACE FUNCTION get_pnl(p_from date, p_to date)
RETURNS TABLE (
  revenue_mvr        NUMERIC,
  cogs_mvr           NUMERIC,
  gross_profit_mvr   NUMERIC,
  marketing_mvr      NUMERIC,   -- prorated by day-overlap with the period
  other_opex_mvr     NUMERIC,
  net_profit_mvr     NUMERIC,
  gross_margin_pct   NUMERIC,
  net_margin_pct     NUMERIC,
  opex_by_category   JSONB,     -- [{name, amount}] sorted by amount desc
  has_estimated_cost BOOLEAN    -- any line still on legacy cost fallback
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  latest_landed AS (
    SELECT DISTINCT ON (sku_id) sku_id, landed_per_piece_mvr
    FROM v_batch_stock
    WHERE qty_pieces_remaining > 0
    ORDER BY sku_id, received_at DESC
  ),
  sales AS (
    SELECT
      COALESCE(SUM(sol.line_total_mvr), 0) AS revenue,
      COALESCE(SUM(sol.qty_pieces * COALESCE(sol.landed_cost_per_piece_mvr, ll.landed_per_piece_mvr, 0)), 0) AS cogs,
      BOOL_OR(sol.landed_cost_per_piece_mvr IS NULL) AS est
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    LEFT JOIN latest_landed ll ON ll.sku_id = sol.sku_id
    WHERE so.status NOT IN ('draft', 'cancelled')
      AND so.created_at::DATE BETWEEN p_from AND p_to
  ),
  -- Campaign spend prorated by how many of the campaign's days fall in
  -- the reporting period. An open-ended campaign runs to today.
  mktg AS (
    SELECT COALESCE(SUM(
      ms.amount_mvr
      * GREATEST(0, LEAST(COALESCE(ms.end_date, CURRENT_DATE), p_to) - GREATEST(ms.start_date, p_from) + 1)::NUMERIC
      / GREATEST(1, COALESCE(ms.end_date, CURRENT_DATE) - ms.start_date + 1)::NUMERIC
    ), 0) AS spend
    FROM marketing_spend ms
    WHERE ms.start_date <= p_to
      AND COALESCE(ms.end_date, CURRENT_DATE) >= p_from
  ),
  opex_total AS (
    SELECT COALESCE(SUM(amount_mvr), 0) AS total
    FROM business_expenses
    WHERE expense_date BETWEEN p_from AND p_to
  ),
  opex_cats AS (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', name, 'amount', amount) ORDER BY amount DESC),
      '[]'::jsonb
    ) AS by_category
    FROM (
      SELECT ec.name, SUM(b.amount_mvr) AS amount
      FROM business_expenses b
      JOIN expense_categories ec ON ec.id = b.category_id
      WHERE b.expense_date BETWEEN p_from AND p_to
      GROUP BY ec.name
    ) x
  )
  SELECT
    s.revenue,
    ROUND(s.cogs, 2),
    ROUND(s.revenue - s.cogs, 2),
    ROUND(m.spend, 2),
    ot.total,
    ROUND(s.revenue - s.cogs - m.spend - ot.total, 2),
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs) / s.revenue * 100, 1) ELSE NULL END,
    CASE WHEN s.revenue > 0 THEN ROUND((s.revenue - s.cogs - m.spend - ot.total) / s.revenue * 100, 1) ELSE NULL END,
    oc.by_category,
    COALESCE(s.est, false)
  FROM sales s, mktg m, opex_total ot, opex_cats oc;
$$;

-- 0053 default privileges already lock new functions to authenticated +
-- service_role; grant is explicit anyway for clarity.
REVOKE EXECUTE ON FUNCTION get_pnl(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_pnl(date, date) TO authenticated, service_role;

COMMIT;
