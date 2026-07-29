-- 0109 — Count reporting must only count corrections that are still real.
--
-- WHAT ALI SAW
-- "Xtra Kering L — wrong 3 of 3 counts, MVR 820 of error." Alarming, and
-- wrong. Two of those three corrections no longer exist in the stock ledger.
--
-- WHY
-- On 6 and 7 July two verifications recorded a shortfall of 84 pieces each.
-- On 8 July a GRN was force-voided — and admin_force_void_grn deletes ALL
-- linked data, which removed the batches those adjustments hung off, taking
-- the adjustment movements with them. The verification SESSION rows survived
-- (nothing cascades to them), so the count report kept reporting corrections
-- whose effect on stock had been erased. Early July was setup and testing —
-- the audit trail for those days is full of force-voids, deleted test orders
-- and "Reason: Test" — so those two rows describe a warehouse that no longer
-- exists.
--
-- Checked, not assumed:
--   06 Jul  -84 pcs  adjustment in ledger: NO
--   07 Jul  -84 pcs  adjustment in ledger: NO
--   21 Jul +132 pcs  adjustment in ledger: YES
--   23 Jul +126 pcs  adjustment in ledger: YES
--   23 Jul -152 pcs  adjustment in ledger: YES
--
-- THE RULE
-- A correction counts only if its stock movement is still in the ledger. That
-- is the same principle the rest of this app runs on: stock is the sum of
-- movements, so if the movement is gone, the correction did not happen. Lines
-- that matched (delta 0) legitimately have no movement and are always kept.
--
-- Nothing is deleted. The orphaned rows stay on record; they simply stop being
-- counted as business events. If the movements were ever restored the report
-- would pick them back up on its own.

-- Which verification lines still have a real effect on stock.
create or replace view public.v_stock_count_lines_live
with (security_invoker = on)
as
select l.*, s.verified_at, s.godown_id, s.verified_by, s.scope_lines,
       s.lines_discrepant, s.lines_total, s.notes as session_notes
from public.stock_verification_lines l
join public.stock_verification_sessions s on s.id = l.session_id
where l.delta_pieces = 0
   or exists (select 1 from public.stock_movements m
              where m.source_id = l.session_id and m.sku_id = l.sku_id);

comment on view public.v_stock_count_lines_live is
  'Verification lines whose stock effect still exists. A correction whose '
  'adjustment movement was deleted (e.g. by admin_force_void_grn, which drops '
  'all linked data) is no longer part of the ledger and must not be reported '
  'as a business event.';

revoke all on public.v_stock_count_lines_live from public, anon;
grant select on public.v_stock_count_lines_live to authenticated, service_role;

-- ── Summary ─────────────────────────────────────────────────────────────────
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
    from v_stock_count_lines_live l
    left join last_landed ll on ll.sku_id = l.sku_id
    where (p_from is null or l.verified_at::date >= p_from)
      and (p_to   is null or l.verified_at::date <= p_to)
  ),
  sess as (
    select distinct l.session_id, l.scope_lines, l.lines_discrepant, l.verified_at
    from lines l
  )
  select jsonb_build_object(
    'sessions',       (select count(*) from sess),
    'full_counts',    (select count(*) from sess where scope_lines is not null),
    'corrections',    (select count(*) from sess where scope_lines is null),
    'items_checked',  (select coalesce(sum(scope_lines), 0) from sess where scope_lines is not null),
    'lines_adjusted', (select count(*) from lines where delta_pieces <> 0),
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

-- ── Per-session ─────────────────────────────────────────────────────────────
drop function if exists public.get_stock_count_sessions(date, date);

create function public.get_stock_count_sessions(
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
  live as (
    select l.*, coalesce(ll.landed_per_piece_mvr, 0) as cost
    from v_stock_count_lines_live l
    left join last_landed ll on ll.sku_id = l.sku_id
    where (p_from is null or l.verified_at::date >= p_from)
      and (p_to   is null or l.verified_at::date <= p_to)
  )
  select
    s.id, s.verified_at, s.godown_id, g.name,
    coalesce(up.full_name, 'Unknown'),
    s.lines_total, s.lines_discrepant, s.scope_lines,
    (s.scope_lines is not null),
    case when s.scope_lines is not null and s.scope_lines > 0
      then round(((s.scope_lines - s.lines_discrepant)::numeric / s.scope_lines) * 100, 1)
      else null end,
    coalesce(sum(v.delta_pieces), 0),
    coalesce(sum(abs(v.delta_pieces)), 0),
    round(coalesce(sum(v.delta_pieces * v.cost), 0), 2),
    round(coalesce(sum(abs(v.delta_pieces * v.cost)), 0), 2),
    s.notes
  from stock_verification_sessions s
  join live v on v.session_id = s.id      -- inner join drops orphaned sessions
  join godowns g on g.id = s.godown_id
  left join user_profiles up on up.id = s.verified_by
  group by s.id, s.verified_at, s.godown_id, g.name, up.full_name,
           s.lines_total, s.lines_discrepant, s.scope_lines, s.notes
  order by s.verified_at desc
  limit 200;
$$;

-- ── Per product ─────────────────────────────────────────────────────────────
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
stable
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
    max(l.verified_at)
  from v_stock_count_lines_live l
  join skus sk           on sk.id = l.sku_id
  join variants v        on v.id  = sk.variant_id
  join product_models pm on pm.id = v.model_id
  join brands b          on b.id  = pm.brand_id
  left join last_landed ll on ll.sku_id = sk.id
  where (p_from is null or l.verified_at::date >= p_from)
    and (p_to   is null or l.verified_at::date <= p_to)
  group by sk.id, b.name, pm.name, v.display_name, sk.pcs_per_pack, sk.packs_per_carton
  having count(*) filter (where l.delta_pieces <> 0) > 0
  order by round(coalesce(sum(abs(l.delta_pieces * coalesce(ll.landed_per_piece_mvr, 0))), 0), 2) desc
  limit 200;
$$;

revoke execute on function public.get_stock_count_sessions(date, date) from public, anon;
revoke execute on function public.get_stock_count_summary(date, date)  from public, anon;
revoke execute on function public.get_stock_count_variance(date, date) from public, anon;
grant execute on function public.get_stock_count_sessions(date, date) to authenticated, service_role;
grant execute on function public.get_stock_count_summary(date, date)  to authenticated, service_role;
grant execute on function public.get_stock_count_variance(date, date) to authenticated, service_role;
