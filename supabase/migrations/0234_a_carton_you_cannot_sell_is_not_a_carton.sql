-- 0234 — a carton you cannot sell is not a carton.
--
-- Ali, 2026-08-30, trying to write a sale:
--   *"In sales add new sale mamypoko xtra kering xxxl 32pcs/pack which comes in
--    3 packs per carton. I cannot sell by carton. The feature is not there."*
--
-- The feature is there. Every other X-Tra Kering size sells by the carton and
-- always has. MAMY-XTRA-XXXL-32x3 carried `sellable_units = {pack}` — the only
-- SKU in the whole catalogue that could not be sold in the unit it ships in.
-- The New Sale sheet was doing exactly what it is told to: sellableTiers()
-- offers what the SKU says it sells and never invents a tier. So the screen was
-- right, the data was wrong, and nothing anywhere compared the two.
--
-- ── THE ROW CONTRADICTED ITSELF, AND NOTHING NOTICED ──────────────────────
--
-- This is not a missing field. The same row says all of:
--
--     packs_per_carton            3        a carton exists, and holds 3 packs
--     fixed_price_per_carton_mvr  790      a carton has a price, MVR 80 off
--     sellable_units              {pack}   there is no such thing as a carton
--
-- A carton price of 790 against 3 x 290 is a deliberate MVR 80 carton
-- discount. Somebody set that up to be sold. It could not be.
--
-- ── WHY IT SURVIVED A DAY OF WORK ON THIS EXACT SKU ───────────────────────
--
-- The pack size of this SKU was restated this morning (0224, 34x3 -> 32x3) and
-- its code renamed. The audit log shows those two changes and nothing else:
-- sellable_units was never touched, today or ever. It has been {pack} since the
-- row was created. Every check that ran near it — the restatement guard, the
-- code-matches-config test, the price-gap tests — asked whether the numbers
-- agreed with each other. None asked whether the row could be SOLD, because
-- the units rule was only ever enforced in one direction: never OFFER a tier
-- the SKU does not sell. The mirror of it — never WITHHOLD a tier the SKU
-- plainly does sell — was written nowhere, so a SKU could quietly refuse the
-- carton trade with no error, no warning and no failing test.
--
-- The whole catalogue was swept for this: 31 SKUs, exactly one wrong.

do $$
declare
  v_id  uuid;
  v_old text[];
  v_ppc int;
begin
  select id, sellable_units, packs_per_carton
    into v_id, v_old, v_ppc
    from public.skus where internal_code = 'MAMY-XTRA-XXXL-32x3';

  if v_id is null then
    raise notice 'MAMY-XTRA-XXXL-32x3 not present — nothing to correct';
    return;
  end if;

  -- Only ADD the carton. If the pack were ever removed this would be a
  -- different change and should not ride along with it.
  if 'carton' = any(v_old) then
    raise notice 'MAMY-XTRA-XXXL-32x3 already sells by the carton';
    return;
  end if;

  if v_ppc <= 1 then
    raise exception
      'MAMY-XTRA-XXXL-32x3 has % packs to a carton, so a carton is not a '
      'distinct unit — refusing to offer one', v_ppc;
  end if;

  update public.skus
     set sellable_units = array['pack', 'carton'],
         updated_at = now()
   where id = v_id;

  insert into audit_log (table_name, record_id, action, field_name,
                         old_value, new_value, reason, changed_by)
  values ('skus', v_id, 'update', 'sellable_units',
          array_to_string(v_old, ','), 'pack,carton',
          'The row said a carton is 3 packs and priced one at MVR 790, then '
          'refused to sell it. Ali could not write a carton line for the only '
          'SKU in the catalogue in that state. No price, cost, stock or pack '
          'configuration changed — only what may be sold.',
          null);
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- THE GUARD, IN THE DIRECTION THAT WAS MISSING
-- ══════════════════════════════════════════════════════════════════════════
-- "Never offer a unit the SKU does not sell" was enforced in code. Its mirror
-- was not enforced anywhere, which is why this cost Ali a sale rather than
-- raising an error. A row that ships in cartons must be sellable in cartons.
--
-- Deliberately a CHECK and not a convention. The two ways to be wrong are not
-- equal: a constraint that is one day too strict produces an error message
-- naming this rule, which Ali reads and I relax. No constraint produces a SKU
-- that silently cannot be sold in the unit it arrives in, which he finds out
-- with a customer waiting. Today zero rows violate it.
alter table public.skus drop constraint if exists skus_carton_is_sellable_chk;
alter table public.skus add  constraint skus_carton_is_sellable_chk check (
  packs_per_carton <= 1 or 'carton' = any(sellable_units)
);

comment on constraint skus_carton_is_sellable_chk on public.skus is
  'If a carton holds more than one pack then the carton is a real trade unit '
  'and must be sellable. The opposite rule — never offer a tier the SKU does '
  'not sell — lived in sellableTiers() from the start; this one lived nowhere, '
  'so MAMY-XTRA-XXXL-32x3 shipped in cartons, priced a carton at MVR 790 and '
  'could not sell one (0234).';

do $$
declare v_bad text;
begin
  select string_agg(internal_code, ', ' order by internal_code) into v_bad
    from public.skus
   where packs_per_carton > 1 and not ('carton' = any(sellable_units));
  if v_bad is not null then
    raise exception 'SKU(s) still cannot sell the carton they ship in: %', v_bad;
  end if;

  if exists (
    select 1 from public.skus
     where internal_code = 'MAMY-XTRA-XXXL-32x3'
       and not ('carton' = any(sellable_units) and 'pack' = any(sellable_units))
  ) then
    raise exception 'MAMY-XTRA-XXXL-32x3 does not sell both a pack and a carton';
  end if;
end $$;
