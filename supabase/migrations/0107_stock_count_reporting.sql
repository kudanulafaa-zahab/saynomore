-- 0107 — Stock count results: accuracy, money, and repeat offenders.
--
-- Five physical counts have been done. All that was reported back was a thin
-- history list: date, godown, lines counted, lines wrong, net pieces. Three
-- things were missing, and each of them is the reason you count at all.
--
-- 1. MONEY. "net -152 pieces" is not a number anyone can act on. A variance
--    only means something valued at cost. Lines are valued at the SKU's last
--    known landed cost — the same fallback used by get_price_book (0092), so
--    a product that is currently out of stock still values correctly instead
--    of silently costing zero.
--
-- 2. ABSOLUTE, NOT JUST NET. Netting is how count variance gets hidden: on
--    2026-07-23 one SKU came in at -152 and another at +126, which nets to a
--    tidy-looking -26 while BOTH records were wrong. Warehouse practice is to
--    report absolute variance (sum of |delta|) as the measure of how wrong the
--    books were, and net separately as the P&L effect. Both are returned.
--
-- 3. INVENTORY RECORD ACCURACY (IRA) — the standard cycle-count KPI:
--       lines counted correct / lines counted x 100
--    It is the one number that says whether the stock records can be trusted,
--    and it is what turns counting from a chore into a measurement. Right now
--    it is 0% — every line ever counted was wrong — which is exactly the kind
--    of thing that should have been on screen already.
--
-- 4. REPEAT OFFENDERS. One SKU (Xtra Kering L) has drifted in three separate
--    counts. A product that keeps drifting is a process problem — mispicks,
--    unrecorded damage, theft — not a counting problem, and it is invisible
--    unless something groups variance BY PRODUCT across sessions. That is
--    what get_stock_count_variance is for.

-- ── Per-session results ─────────────────────────────────────────────────────
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
  accuracy_pct      numeric,
  net_delta_pieces  bigint,
  abs_delta_pieces  bigint,
  net_value_mvr     numeric,
  abs_value_mvr     numeric,
  notes             text
)
language sql
stable
security definer            -- resolves counter names from user_profiles
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
    s.lines_total, s.lines_discrepant,
    case when s.lines_total > 0
      then round(((s.lines_total - s.lines_discrepant)::numeric / s.lines_total) * 100, 1)
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

-- ── Which products keep drifting ────────────────────────────────────────────
create or replace function public.get_stock_count_variance(
  p_from date default null,
  p_to   date default null
)
returns table (
  sku_id            uuid,
  brand_name        text,
  model_name        text,
  variant_display   text,
  pcs_per_pack      int,
  packs_per_carton  int,
  times_counted     bigint,
  times_wrong       bigint,
  net_delta_pieces  bigint,
  abs_delta_pieces  bigint,
  net_value_mvr     numeric,
  abs_value_mvr     numeric,
  last_counted_at   timestamptz
)
language sql
stable                       -- SECURITY INVOKER: count tables are readable to all signed-in users
set search_path = public
as $$
  with last_landed as (
    select distinct on (ib.sku_id) ib.sku_id, ib.landed_per_piece_mvr
    from inventory_batches ib
    where ib.landed_per_piece_mvr is not null
    order by ib.sku_id, ib.received_at desc nulls last, ib.created_at desc
  )
  select
    sk.id, b.name, pm.name, v.display_name,
    sk.pcs_per_pack, sk.packs_per_carton,
    count(*),
    count(*) filter (where l.delta_pieces <> 0),
    coalesce(sum(l.delta_pieces), 0),
    coalesce(sum(abs(l.delta_pieces)), 0),
    round(coalesce(sum(l.delta_pieces * coalesce(ll.landed_per_piece_mvr, 0)), 0), 2),
    round(coalesce(sum(abs(l.delta_pieces * coalesce(ll.landed_per_piece_mvr, 0))), 0), 2),
    max(s.verified_at)
  from stock_verification_lines l
  join stock_verification_sessions s on s.id = l.session_id
  join skus sk           on sk.id = l.sku_id
  join variants v        on v.id  = sk.variant_id
  join product_models pm on pm.id = v.model_id
  join brands b          on b.id  = pm.brand_id
  left join last_landed ll on ll.sku_id = sk.id
  where (p_from is null or s.verified_at::date >= p_from)
    and (p_to   is null or s.verified_at::date <= p_to)
  group by sk.id, b.name, pm.name, v.display_name, sk.pcs_per_pack, sk.packs_per_carton
  having count(*) filter (where l.delta_pieces <> 0) > 0
  -- Worst money impact first — absolute, so offsetting errors don't hide.
  order by round(coalesce(sum(abs(l.delta_pieces * coalesce(ll.landed_per_piece_mvr, 0))), 0), 2) desc
  limit 200;
$$;

-- ── Headline accuracy ───────────────────────────────────────────────────────
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
  lines as (
    select l.*, coalesce(ll.landed_per_piece_mvr, 0) as cost
    from stock_verification_lines l
    join stock_verification_sessions s on s.id = l.session_id
    left join last_landed ll on ll.sku_id = l.sku_id
    where (p_from is null or s.verified_at::date >= p_from)
      and (p_to   is null or s.verified_at::date <= p_to)
  )
  select jsonb_build_object(
    'sessions', (
      select count(*) from stock_verification_sessions s
      where (p_from is null or s.verified_at::date >= p_from)
        and (p_to   is null or s.verified_at::date <= p_to)),
    'lines_counted',  (select count(*) from lines),
    'lines_wrong',    (select count(*) from lines where delta_pieces <> 0),
    -- Inventory Record Accuracy: the share of counted lines the books got right.
    'accuracy_pct',   (select case when count(*) > 0
                         then round(((count(*) - count(*) filter (where delta_pieces <> 0))::numeric
                                     / count(*)) * 100, 1)
                         else null end from lines),
    -- Net = the P&L effect. Absolute = how wrong the books were.
    'net_value_mvr',  (select round(coalesce(sum(delta_pieces * cost), 0), 2) from lines),
    'abs_value_mvr',  (select round(coalesce(sum(abs(delta_pieces * cost)), 0), 2) from lines),
    'last_counted_at',(select max(s.verified_at) from stock_verification_sessions s
                        where (p_from is null or s.verified_at::date >= p_from)
                          and (p_to   is null or s.verified_at::date <= p_to))
  );
$$;

revoke execute on function public.get_stock_count_sessions(date, date) from public, anon;
revoke execute on function public.get_stock_count_variance(date, date) from public, anon;
revoke execute on function public.get_stock_count_summary(date, date)  from public, anon;

grant execute on function public.get_stock_count_sessions(date, date) to authenticated, service_role;
grant execute on function public.get_stock_count_variance(date, date) to authenticated, service_role;
grant execute on function public.get_stock_count_summary(date, date)  to authenticated, service_role;
