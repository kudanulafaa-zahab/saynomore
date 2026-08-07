-- 0153 — the last UTC date buckets: stock counting, and expiry.
--
-- Ali, 2026-08-06: "Can you make sure absolutely everything is on Maldives
-- time. Make sure it's correct."
--
-- 0152 swept one pattern (CURRENT_DATE) in one place (functions). That was
-- not "everything", and this migration is what a proper sweep found. The bug
-- class has TWO shapes and lives in TWO kinds of object:
--
--   shape 1  CURRENT_DATE                 — the server's UTC day
--   shape 2  <timestamptz col>::date      — buckets an instant on the UTC day
--   place 1  functions                    — swept in 0152
--   place 2  VIEWS                        — never looked at until now
--
-- Detected by listing every genuine `timestamp with time zone` column in the
-- schema (a real `date` column has no timezone to get wrong, so matching on
-- column names alone would have produced false positives like expense_date)
-- and matching those against every function body AND every view definition.
--
-- What it found:
--
--   get_stock_count_sessions   verified_at::date, twice — the from/to filter
--   get_stock_count_summary    same
--   get_stock_count_variance   same
--       A stock count taken after 19:00 UTC is already tomorrow in Male, so
--       it filed under the wrong day and could fall outside the range Ali
--       actually asked for.
--
--   v_expiring_stock           CURRENT_DATE, twice — days_left, and the
--       120-day window. This one is a VIEW, which is exactly why 0152 missed
--       it: that migration's guard only read pg_proc. It feeds
--       expiring_value_mvr in the morning briefing, so it is a money figure,
--       not just a label — a batch could read one day further from expiry
--       than it is, for five hours of every day.
--
-- The guard at the bottom now covers both shapes across both kinds of object,
-- and it is what caught v_expiring_stock: the first attempt at this migration
-- aborted on it. That is the guard doing its job before the mistake shipped,
-- rather than after.
--
-- security_invoker = true is restated on the view deliberately: CREATE OR
-- REPLACE VIEW does NOT preserve reloptions, and dropping it would hand every
-- caller the view owner's rights. That regression happened once already and
-- was caught by the advisor (migration 0125).
--
-- The function bodies are rewritten by substitution rather than retyped, so
-- nothing but the dates can change, and the migration asserts it rewrote
-- exactly three.

BEGIN;

-- ── 1. The three stock-count date filters ─────────────────────────────────
DO $mig$
DECLARE r record; newdef text; n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace nm ON nm.oid = p.pronamespace
     WHERE nm.nspname='public' AND p.prokind='f'
       AND p.proname IN ('get_stock_count_sessions','get_stock_count_summary',
                         'get_stock_count_variance')
  LOOP
    newdef := regexp_replace(r.def,
      '\y(\w+)\.(created_at|updated_at|received_at|paid_at|delivered_at|dispatched_at|picked_at|cash_deposited_at|arrived_at|grn_confirmed_at|ordered_at|verified_at|last_paid_at)::date',
      '(\1.\2 at time zone ''Indian/Maldives'')::date', 'g');
    IF newdef IS DISTINCT FROM r.def THEN EXECUTE newdef; n := n + 1; END IF;
  END LOOP;
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 function rewrites, got %', n; END IF;
END $mig$;

-- ── 2. v_expiring_stock — the view the 0152 sweep never looked at ─────────
CREATE OR REPLACE VIEW public.v_expiring_stock WITH (security_invoker = true) AS
 SELECT bs.sku_id,
    b.expiry_date,
    b.expiry_date - (now() AT TIME ZONE 'Indian/Maldives')::date AS days_left,
    sum(bs.qty_pieces_remaining) AS pieces,
    round(sum(bs.qty_pieces_remaining::numeric * COALESCE(bs.landed_per_piece_mvr, 0::numeric)), 2) AS value_mvr
   FROM v_batch_stock bs
     JOIN inventory_batches b ON b.id = bs.batch_id
  WHERE b.expiry_date IS NOT NULL
    AND bs.qty_pieces_remaining > 0
    AND b.expiry_date <= ((now() AT TIME ZONE 'Indian/Maldives')::date + 120)
  GROUP BY bs.sku_id, b.expiry_date;

-- ── 3. Both shapes, both kinds of object ──────────────────────────────────
DO $chk$
DECLARE bad text;
BEGIN
  WITH src AS (
    SELECT 'function ' || p.proname AS obj, p.prosrc AS body
      FROM pg_proc p JOIN pg_namespace nm ON nm.oid = p.pronamespace
     WHERE nm.nspname='public' AND p.prokind='f'
    UNION ALL
    SELECT 'view ' || c.relname, pg_get_viewdef(c.oid, true)
      FROM pg_class c JOIN pg_namespace nm ON nm.oid = c.relnamespace
     WHERE nm.nspname='public' AND c.relkind IN ('v','m')
  )
  SELECT string_agg(DISTINCT obj, ', ') INTO bad FROM src
   WHERE body ~ '\y(\w+)\.(created_at|updated_at|received_at|paid_at|delivered_at|dispatched_at|picked_at|cash_deposited_at|arrived_at|grn_confirmed_at|ordered_at|verified_at|last_paid_at)::date'
      OR body ~* '\yCURRENT_DATE\y';
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'still bucketing on the server UTC day: %', bad;
  END IF;
END $chk$;

COMMIT;
