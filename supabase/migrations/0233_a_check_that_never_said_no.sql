-- 0233 — the net-content check never actually said no.
--
-- 0232 added "both or neither" for unit_size / unit_size_uom. It was written as
--
--     (unit_size is null and unit_size_uom is null)
--     or (unit_size > 0 and unit_size_uom in ('ml', 'g'))
--
-- and it does not hold. Feed it a size with no unit — 500 and null:
--
--     branch 1 : (false and true)                   -> false
--     branch 2 : (500 > 0) and (null in ('ml','g')) -> true and NULL -> NULL
--     result   : false or NULL                      -> NULL
--
-- A CHECK constraint rejects a row only when it evaluates to FALSE. NULL is
-- accepted. The mirror case is the same shape: a unit with no size gives
-- (null > 0) -> NULL, so that passes too. The ONLY thing the constraint ever
-- caught was a zero size WITH a unit, where 0 > 0 is a real false.
--
-- So both halves of the rule the comment claimed were unenforced, and the
-- error message written for it — "700 of what?" — could never fire.
--
-- ── HOW IT WAS FOUND, AND WHY THAT IS THE POINT ───────────────────────────
--
-- net_content.test.sql asserts the refusal rather than the wording, and was
-- checked against production before being trusted. The comparison assertions
-- all passed; this one reported NO ERROR RAISED. A constraint is the one kind
-- of code that looks identical whether it works or not — nothing goes wrong
-- until someone relies on it — so it has to be driven, not read.
--
-- ── NOTHING TO REPAIR ─────────────────────────────────────────────────────
--
-- No row is half-filled: 5 SKUs carry 700 ml and every other row is null on
-- both columns. Edit SKU writes the pair together or writes neither, so the
-- hole was never reachable from a screen. This closes it before it is.

alter table public.skus drop constraint if exists skus_unit_size_chk;

-- num_nulls() counts NULLs across its arguments and is itself never NULL, so
-- there is no three-valued gap to fall through. The second branch guards each
-- column with IS NOT NULL before comparing it, for the same reason.
alter table public.skus add constraint skus_unit_size_chk check (
  num_nulls(unit_size, unit_size_uom) = 2
  or (
        unit_size     is not null and unit_size > 0
    and unit_size_uom is not null and unit_size_uom in ('ml', 'g')
  )
);

comment on constraint skus_unit_size_chk on public.skus is
  'Net content is both-or-neither, and a size is a positive number of ml or g. '
  'NULL-safe via num_nulls: the 0232 spelling evaluated to NULL for a size '
  'without a unit and CHECK only rejects FALSE, so it accepted the very rows '
  'it was written to refuse (0233).';

-- ══════════════════════════════════════════════════════════════════════════
-- DRIVE IT. All four corners, in this migration, or it does not ship.
-- ══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_sku    uuid;
  v_size   numeric;
  v_uom    text;
  v_failed text[] := '{}';
  r        record;
begin
  -- ANY SKU will do — the guard is a property of the column, not of a product.
  -- Whatever it currently holds (usually nothing at all) is put back at the
  -- end. Asking for one that already has a size would fail on a fresh database
  -- where none does, which is exactly the census mistake 0232 just made.
  select id, unit_size, unit_size_uom into v_sku, v_size, v_uom
    from public.skus order by internal_code limit 1;
  if v_sku is null then
    raise notice 'no products yet — nothing to drive the net-content guard against';
    return;
  end if;

  for r in
    select * from (values
      (500::numeric, null::text,  true,  'a size with no unit'),
      (null::numeric, 'ml'::text, true,  'a unit with no size'),
      (0::numeric,    'ml'::text, true,  'a container holding nothing'),
      (-1::numeric,   'ml'::text, true,  'a negative net content'),
      (700::numeric,  'oz'::text, true,  'a unit we do not measure in'),
      (700::numeric,  'ml'::text, false, 'an honest 700ml'),
      (null::numeric, null::text, false, 'an honest blank')
    ) as t(size, uom, must_refuse, what)
  loop
    begin
      update public.skus set unit_size = r.size, unit_size_uom = r.uom where id = v_sku;
      if r.must_refuse then
        v_failed := v_failed || (r.what || ' was ACCEPTED');
      end if;
    exception when check_violation then
      if not r.must_refuse then
        v_failed := v_failed || (r.what || ' was REFUSED');
      end if;
    end;
  end loop;

  update public.skus set unit_size = v_size, unit_size_uom = v_uom where id = v_sku;

  if array_length(v_failed, 1) is not null then
    raise exception 'the net-content guard is still wrong: %', array_to_string(v_failed, '; ');
  end if;

  if (select count(*) from public.skus
       where (unit_size is null) <> (unit_size_uom is null)) <> 0 then
    raise exception 'a half-filled net content survived the fix';
  end if;

  -- The product used as a test bench must be exactly as it was found.
  if exists (
    select 1 from public.skus
     where id = v_sku
       and (unit_size is distinct from v_size or unit_size_uom is distinct from v_uom)
  ) then
    raise exception 'the product driven against was not restored to its own net content';
  end if;
end $$;
