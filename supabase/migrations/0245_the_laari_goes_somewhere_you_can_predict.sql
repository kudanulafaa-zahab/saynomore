-- 0245 — the leftover laari goes somewhere you can predict, and the trigger
--        function is not callable by strangers.
--
-- 0244 shipped with two defects and CI caught both on the first fresh replay.
-- Neither showed against production, and that is the point of replaying from
-- empty.
--
-- ── 1. A RANDOM UUID WAS DECIDING WHO PAYS THE EXTRA LAARI ────────────────
--
-- The allocation hands the leftover laari to the lines with the biggest
-- fractional remainder. When a carton splits evenly — two colours, two bottles
-- each — every remainder is identical and something has to break the tie.
-- 0244 broke it with `order by frac desc, a.id`, and `id` is a random UUID.
--
-- So the same order, allocated on two databases, could put the extra laari on
-- a different colour. The test asserting the leftover after a colour is removed
-- passed against production and failed in CI for exactly that reason: not a
-- flaky test, a genuinely unpredictable rule.
--
-- Money apportionment has to be reproducible. Anyone should be able to look at
-- an invoice and work out why one colour reads 38.34 and another 38.33, and
-- "because of the row's random identifier" is not an answer. So the tie is
-- broken by things a person can see: the bigger quantity first — the biggest
-- share carries the rounding, which is what an accountant expects — and then
-- the SKU code, which is stable, printed on the label, and the same in every
-- database.
--
-- ── 2. THE TRIGGER FUNCTION WAS REACHABLE BY anon ─────────────────────────
--
-- `allocate_mixed_carton_totals` was revoked from public and anon. Its trigger
-- wrapper was not, and a new function is granted to anon by Supabase's default
-- privileges in its own right. rls_surface.test.sql enumerates EVERY function
-- anon can execute rather than naming the ones anyone remembered, which is the
-- only reason this was caught in the same run that created it.
--
-- A trigger function cannot usefully be called directly — it needs a trigger
-- context — but "cannot be usefully called" has never been the standard here.
-- The standard is that nothing in this schema is reachable without signing in.

create or replace function public.allocate_mixed_carton_totals(p_order_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  v_touched int := 0;
begin
  with grp as (
    select l.id, l.qty_pieces, m.brand_id, s.internal_code,
           sum(l.qty_pieces)      over (partition by m.brand_id) as pieces,
           min(l.unit_price_mvr)  over (partition by m.brand_id) as lo_price,
           max(l.unit_price_mvr)  over (partition by m.brand_id) as hi_price,
           vs.mixed_carton_pieces as per_carton
      from sales_order_lines l
      join skus s           on s.id = l.sku_id
      join v_skus vs        on vs.id = s.id
      join variants v       on v.id = s.variant_id
      join product_models m on m.id = v.model_id
     where l.order_id = p_order_id
       and l.is_mixed_carton_fill
  ),
  target as (
    select g.*,
           -- The carton price THIS ORDER used, recovered from its own per-bottle
           -- figure. Never today's price list: a price set later must not
           -- restate an order agreed at a different one, and a discount given
           -- on the day is just as real as a list price.
           round(round(g.hi_price * g.per_carton, 2) * g.pieces::numeric / g.per_carton, 2) as exact_total
      from grp g
     where g.per_carton > 0
       and g.pieces % g.per_carton = 0   -- whole cartons only; a part carton is not one
       and g.lo_price = g.hi_price       -- one rate across the group, or it is not one carton price to split
  ),
  alloc as (
    select t.id, t.brand_id, t.exact_total, t.qty_pieces, t.internal_code,
           floor(t.exact_total * t.qty_pieces / t.pieces * 100) / 100 as base,
           (t.exact_total * t.qty_pieces / t.pieces * 100)
             - floor(t.exact_total * t.qty_pieces / t.pieces * 100)   as frac
      from target t
  ),
  ranked as (
    select a.*,
           round((a.exact_total - sum(a.base) over (partition by a.brand_id)) * 100) as laari_left,
           -- REPRODUCIBLE, and explainable to the person reading the invoice:
           -- biggest remainder first, then the biggest quantity — the largest
           -- share carries the rounding — then the SKU code, which is stable
           -- and printed on the label. Never the row id: it is random, so it
           -- allocated differently on two databases (0245).
           row_number() over (
             partition by a.brand_id
             order by a.frac desc, a.qty_pieces desc, a.internal_code
           ) as rn
      from alloc a
  ),
  fixed as (
    update sales_order_lines l
       set line_total_mvr = r.base + case when r.rn <= r.laari_left then 0.01 else 0 end
      from ranked r
     where l.id = r.id
       and l.line_total_mvr is distinct from
           (r.base + case when r.rn <= r.laari_left then 0.01 else 0 end)
    returning 1
  )
  select count(*) into v_touched from fixed;

  return v_touched;
end;
$$;

revoke execute on function public.allocate_mixed_carton_totals(uuid) from public, anon;
grant  execute on function public.allocate_mixed_carton_totals(uuid) to authenticated, service_role;

-- FROM BOTH, on the wrapper too. CREATE FUNCTION grants EXECUTE to PUBLIC and
-- Supabase's ALTER DEFAULT PRIVILEGES grants it to anon separately; removing
-- either one alone leaves it callable with the publishable key.
revoke execute on function public.trg_allocate_mixed_carton() from public, anon;
grant  execute on function public.trg_allocate_mixed_carton() to authenticated, service_role;

-- ── The guard ─────────────────────────────────────────────────────────────
-- Both defects, asked as questions rather than reasoned about. The second is
-- the one that has now caught three separate attempts that read as closed.
do $$
begin
  if has_function_privilege('anon', 'public.trg_allocate_mixed_carton()', 'execute')
     or has_function_privilege('anon', 'public.allocate_mixed_carton_totals(uuid)', 'execute') then
    raise exception 'the mixed-carton allocation is still reachable by anon';
  end if;

  if exists (
    select 1 from pg_proc p
     where p.oid = 'public.allocate_mixed_carton_totals(uuid)'::regprocedure
       and pg_get_functiondef(p.oid) like '%a.frac desc, a.id%'
  ) then
    raise exception 'the allocation still breaks ties on a random row id';
  end if;
end $$;
