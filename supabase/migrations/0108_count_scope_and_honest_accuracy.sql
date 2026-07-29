-- 0108 — Fix the accuracy figure I shipped in 0107. It was meaningless.
--
-- WHAT WENT WRONG
-- 0107 reported "Stock record accuracy" as
--     (lines_total - lines_discrepant) / lines_total
-- which assumed lines_total meant "items counted". It does not. The count
-- sheet only submits the rows the counter CHANGED (`edits`), so
-- record_verification only ever writes a line for a correction:
--
--     5 sessions · 5 lines stored · 5 discrepant · 0 that matched
--
-- lines_total therefore equals lines_discrepant by construction, and the
-- accuracy is forced to 0% no matter how good or bad the real records are.
-- It told Ali his stock records were perfectly wrong when it was actually
-- measuring nothing. A number that can only ever read 0% is worse than no
-- number, because it looks like information.
--
-- THE REAL PROBLEM UNDERNEATH
-- Inventory Record Accuracy needs the denominator "how many items did you
-- actually check", including the ones that turned out right. The app never
-- captured that — it captured corrections only. So it cannot be derived from
-- existing data, and no amount of re-arranging the report will produce it.
-- The five sessions on record are stock CORRECTIONS, not counts, and are
-- described that way from now on.
--
-- THE FIX
-- Capture the scope. `scope_lines` records how many items the counter
-- actually verified in that session. The count sheet asks, rather than
-- assuming: silently treating every untouched row as "counted and correct"
-- would invent verification that never happened, which is a worse lie than
-- the broken percentage.
--
--   scope_lines IS NULL  → a correction. Money impact is still exact and
--                          still reported; accuracy simply is not known.
--   scope_lines = N      → a real count of N items; accuracy is
--                          (N - discrepant) / N and is finally meaningful.
--
-- Money figures from 0107 were never affected by this: they come from real
-- delta_pieces valued at landed cost, and stay exactly as they were.

alter table public.stock_verification_sessions
  add column if not exists scope_lines int;

comment on column public.stock_verification_sessions.scope_lines is
  'How many items the counter actually verified in this session, including '
  'ones that matched. NULL = a targeted correction, not a full count — '
  'accuracy is not computable for it. Set only when the counter confirms '
  'they checked every item on the sheet.';

-- ── record_verification: accept the scope ───────────────────────────────────
-- Adding a defaulted parameter keeps the existing 3-argument call working.
create or replace function public.record_verification(
  p_godown_id  uuid,
  p_counts     jsonb,
  p_notes      text default null,
  p_scope_lines int default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_user      UUID := auth.uid();
  v_session   UUID;
  v_item      JSONB;
  v_sku       UUID;
  v_counted   INTEGER;
  v_reason    TEXT;
  v_expected  INTEGER;
  v_delta     INTEGER;
  v_remaining INTEGER;
  v_take      INTEGER;
  v_batch     RECORD;
  v_target_batch UUID;
  v_total     INTEGER := 0;
  v_discrep   INTEGER := 0;
  v_net       INTEGER := 0;
BEGIN
  IF NOT is_admin_or_manager() THEN
    RAISE EXCEPTION 'Only an admin or manager can record a stock verification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM godowns WHERE id = p_godown_id) THEN
    RAISE EXCEPTION 'Invalid warehouse';
  END IF;
  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' THEN
    RAISE EXCEPTION 'Counts must be a JSON array';
  END IF;

  INSERT INTO stock_verification_sessions (godown_id, verified_by, notes)
  VALUES (p_godown_id, v_user, p_notes) RETURNING id INTO v_session;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_counts)
  LOOP
    v_sku     := (v_item->>'sku_id')::UUID;
    v_counted := (v_item->>'counted_pieces')::INTEGER;
    v_reason  := NULLIF(v_item->>'reason', '');
    IF v_sku IS NULL OR v_counted IS NULL THEN
      RAISE EXCEPTION 'Each count needs sku_id and counted_pieces';
    END IF;
    IF v_counted < 0 THEN
      RAISE EXCEPTION 'Counted quantity cannot be negative';
    END IF;

    SELECT COALESCE(qty_pieces, 0) INTO v_expected
    FROM v_stock_levels WHERE sku_id = v_sku AND godown_id = p_godown_id;
    v_expected := COALESCE(v_expected, 0);

    v_delta := v_counted - v_expected;
    v_total := v_total + 1;
    INSERT INTO stock_verification_lines
      (session_id, sku_id, expected_pieces, counted_pieces, delta_pieces, reason)
    VALUES (v_session, v_sku, v_expected, v_counted, v_delta, v_reason);

    CONTINUE WHEN v_delta = 0;
    v_discrep := v_discrep + 1;
    v_net     := v_net + v_delta;

    IF v_delta < 0 THEN
      v_remaining := -v_delta;
      FOR v_batch IN
        SELECT bs.batch_id, bs.qty_pieces_remaining
        FROM v_batch_stock bs
        WHERE bs.sku_id = v_sku AND bs.godown_id = p_godown_id AND bs.qty_pieces_remaining > 0
        ORDER BY bs.received_at ASC, bs.batch_id ASC
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := LEAST(v_remaining, v_batch.qty_pieces_remaining);
        INSERT INTO stock_movements
          (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
        VALUES
          (v_batch.batch_id, v_sku, p_godown_id, 'adjustment', -v_take, 'adjustment', v_session,
           COALESCE(v_reason, 'Physical verification shortfall'), v_user);
        v_remaining := v_remaining - v_take;
      END LOOP;
      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'Verification could not reconcile shortfall for SKU % (stock shifted mid-count) - retry', v_sku;
      END IF;
    ELSE
      SELECT b.id INTO v_target_batch FROM inventory_batches b
      WHERE b.sku_id = v_sku AND b.godown_id = p_godown_id
      ORDER BY b.received_at DESC, b.id DESC LIMIT 1;
      IF v_target_batch IS NULL THEN
        SELECT b.id INTO v_target_batch FROM inventory_batches b
        WHERE b.sku_id = v_sku ORDER BY b.received_at DESC, b.id DESC LIMIT 1;
      END IF;
      IF v_target_batch IS NULL THEN
        RAISE EXCEPTION 'Cannot add surplus for a SKU that has never been received (no cost basis exists)';
      END IF;
      INSERT INTO stock_movements
        (batch_id, sku_id, godown_id, movement_type, qty_pieces, source_type, source_id, notes, created_by)
      VALUES
        (v_target_batch, v_sku, p_godown_id, 'adjustment', v_delta, 'adjustment', v_session,
         COALESCE(v_reason, 'Physical verification surplus'), v_user);
    END IF;
  END LOOP;

  UPDATE stock_verification_sessions
  SET lines_total = v_total,
      lines_discrepant = v_discrep,
      net_delta_pieces = v_net,
      -- NULL stays NULL: "we don't know how many items were checked".
      -- Otherwise never claim a narrower scope than the corrections submitted.
      scope_lines = CASE WHEN p_scope_lines IS NULL THEN NULL
                         ELSE GREATEST(p_scope_lines, v_total) END
  WHERE id = v_session;

  INSERT INTO audit_log (table_name, record_id, action, reason, changed_by)
  VALUES ('stock_verification_sessions', v_session, 'insert',
          format('Physical verification; %s lines, %s discrepant, net %s pcs%s',
                 v_total, v_discrep, v_net,
                 CASE WHEN p_scope_lines IS NULL THEN ' (targeted correction)'
                      ELSE format('; %s items checked', GREATEST(p_scope_lines, v_total)) END),
          v_user);
  RETURN v_session;
END $function$;

revoke execute on function public.record_verification(uuid, jsonb, text, int) from public, anon;
grant execute on function public.record_verification(uuid, jsonb, text, int) to authenticated, service_role;

-- ── Sessions: report scope honestly ─────────────────────────────────────────
-- Dropped first: the return columns change (scope_lines, is_full_count,
-- accuracy_pct are new), and Postgres will not replace a function whose OUT
-- parameter row type differs.
drop function if exists public.get_stock_count_sessions(date, date);

create or replace function public.get_stock_count_sessions(
  p_from date default null,
  p_to   date default null
)
returns table (
  session_id        uuid,
  verified_at       timestamptz,
  godown_id         uuid,
  godown_name       text,
  counted_by        text,
  lines_total       int,
  lines_discrepant  int,
  scope_lines       int,
  is_full_count     boolean,
  accuracy_pct      numeric,
  net_delta_pieces  bigint,
  abs_delta_pieces  bigint,
  net_value_mvr     numeric,
  abs_value_mvr     numeric,
  notes             text
)
language sql
stable
security definer
set search_path = public
as $$
  with last_landed as (
    select distinct on (ib.sku_id) ib.sku_id, ib.landed_per_piece_mvr
    from inventory_batches ib
    where ib.landed_per_piece_mvr is not null
    order by ib.sku_id, ib.received_at desc nulls last, ib.created_at desc
  ),
  valued as (
    select l.session_id,
           l.delta_pieces,
           (l.delta_pieces * coalesce(ll.landed_per_piece_mvr, 0))::numeric as delta_value
    from stock_verification_lines l
    left join last_landed ll on ll.sku_id = l.sku_id
  )
  select
    s.id, s.verified_at, s.godown_id, g.name,
    coalesce(up.full_name, 'Unknown'),
    s.lines_total, s.lines_discrepant, s.scope_lines,
    (s.scope_lines is not null),
    -- Only computable when the counter told us how many items they checked.
    case when s.scope_lines is not null and s.scope_lines > 0
      then round(((s.scope_lines - s.lines_discrepant)::numeric / s.scope_lines) * 100, 1)
      else null end,
    coalesce((select sum(v.delta_pieces)      from valued v where v.session_id = s.id), 0),
    coalesce((select sum(abs(v.delta_pieces)) from valued v where v.session_id = s.id), 0),
    round(coalesce((select sum(v.delta_value)      from valued v where v.session_id = s.id), 0), 2),
    round(coalesce((select sum(abs(v.delta_value)) from valued v where v.session_id = s.id), 0), 2),
    s.notes
  from stock_verification_sessions s
  join godowns g on g.id = s.godown_id
  left join user_profiles up on up.id = s.verified_by
  where (p_from is null or s.verified_at::date >= p_from)
    and (p_to   is null or s.verified_at::date <= p_to)
  order by s.verified_at desc
  limit 200;
$$;

-- ── Summary: accuracy only where it is real ─────────────────────────────────
create or replace function public.get_stock_count_summary(
  p_from date default null,
  p_to   date default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with last_landed as (
    select distinct on (ib.sku_id) ib.sku_id, ib.landed_per_piece_mvr
    from inventory_batches ib
    where ib.landed_per_piece_mvr is not null
    order by ib.sku_id, ib.received_at desc nulls last, ib.created_at desc
  ),
  sess as (
    select s.* from stock_verification_sessions s
    where (p_from is null or s.verified_at::date >= p_from)
      and (p_to   is null or s.verified_at::date <= p_to)
  ),
  lines as (
    select l.*, coalesce(ll.landed_per_piece_mvr, 0) as cost
    from stock_verification_lines l
    join sess s on s.id = l.session_id
    left join last_landed ll on ll.sku_id = l.sku_id
  )
  select jsonb_build_object(
    'sessions',           (select count(*) from sess),
    'full_counts',        (select count(*) from sess where scope_lines is not null),
    'corrections',        (select count(*) from sess where scope_lines is null),
    'items_checked',      (select coalesce(sum(scope_lines), 0) from sess where scope_lines is not null),
    'lines_adjusted',     (select count(*) from lines where delta_pieces <> 0),
    -- NULL until at least one session records how many items were checked.
    -- Deliberately not faked from correction-only sessions: that produced a
    -- permanent, meaningless 0%.
    'accuracy_pct', (
      select case when coalesce(sum(scope_lines), 0) > 0
        then round(((sum(scope_lines) - sum(lines_discrepant))::numeric
                    / sum(scope_lines)) * 100, 1)
        else null end
      from sess where scope_lines is not null),
    'net_value_mvr',  (select round(coalesce(sum(delta_pieces * cost), 0), 2) from lines),
    'abs_value_mvr',  (select round(coalesce(sum(abs(delta_pieces * cost)), 0), 2) from lines),
    'last_counted_at',(select max(verified_at) from sess)
  );
$$;

revoke execute on function public.get_stock_count_sessions(date, date) from public, anon;
revoke execute on function public.get_stock_count_summary(date, date)  from public, anon;
grant execute on function public.get_stock_count_sessions(date, date) to authenticated, service_role;
grant execute on function public.get_stock_count_summary(date, date)  to authenticated, service_role;
