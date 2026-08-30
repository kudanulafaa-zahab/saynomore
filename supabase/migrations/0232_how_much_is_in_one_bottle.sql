-- 0232 — how much is in one bottle, so per-100ml can finally be compared.
--
-- Ali, 2026-08-30: *"Sosoft bottles are all 700ml."*
--
-- The competitor sheet has offered Per 100ml and Per 100g since it was built,
-- and both have always normalised to NULL — a price logged that way was stored
-- and then never appeared in any comparison, anywhere. 0223 made that visible
-- ('uncomparable') instead of silent, and named the reason: nothing in this
-- database records how much is IN one of our bottles.
--
-- Ali asked for those two to be kept rather than removed, so this is the
-- figure that switches them on.
--
-- ── WHY IT MATTERS FOR DETERGENT AND NOT FOR NAPPIES ──────────────────────
--
-- A rival's nappy pack is compared per nappy: their 30s against our 44s, which
-- needs only a count. Detergent has no such count — a rival bottle may be
-- 500ml, 1L or 700ml, and MVR 40 tells you nothing until you know how much
-- liquid is in it. Per 100ml is the standard shelf-comparison unit in retail
-- for exactly this reason, and it is the only way to put a 1L rival next to a
-- 700ml Sosoft.
--
-- Worked through on the real catalogue: a rival at MVR 6.50 per 100ml is
-- MVR 45.50 for 700ml, against Ali's MVR 37 a bottle.
--
-- ── THE 700 IS NOT TAKEN ON TRUST ─────────────────────────────────────────
--
-- Every Sosoft variant already carries it in its own display name — "Rose &
-- Water Lily Bottle 700ml", and four more like it. The update asserts the name
-- says 700ml before writing 700, and refuses unless exactly five rows match,
-- so it cannot stamp a size onto a catalogue that has moved on.
--
-- Body Shop's five tubs are deliberately left NULL. Ali gave a figure for
-- Sosoft and not for those, and an invented net content would be worse than an
-- honest blank: the field is there for him to fill, and until he does those
-- products keep reading 'uncomparable' rather than quietly comparing wrong.

alter table public.skus add column if not exists unit_size     numeric;
alter table public.skus add column if not exists unit_size_uom text;

alter table public.skus drop constraint if exists skus_unit_size_chk;
alter table public.skus add  constraint skus_unit_size_chk check (
  (unit_size is null and unit_size_uom is null)
  or (unit_size > 0 and unit_size_uom in ('ml', 'g'))
);

comment on column public.skus.unit_size is
  'How much is in ONE piece — 700 for a 700ml bottle. Null when the product is '
  'counted rather than measured: a nappy has no net content (0232).';
comment on column public.skus.unit_size_uom is
  'ml or g. Null exactly when unit_size is null.';

do $$
declare v_written int;
begin
  update public.skus s
     set unit_size = 700, unit_size_uom = 'ml'
    from public.variants v
   where v.id = s.variant_id
     and s.internal_code like 'SOSO-%'
     and v.display_name ilike '%700ml%';
  get diagnostics v_written = row_count;
  if v_written <> 5 then
    raise exception 'expected 5 Sosoft bottles naming 700ml, updated %', v_written;
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- v_skus CARRIES IT
-- ══════════════════════════════════════════════════════════════════════════
do $mig$
declare
  v_def    text := pg_get_viewdef('public.v_skus'::regclass, true);
  -- ANCHORED ON TWO LINES, NOT ONE. "s.fixed_price_per_carton_mvr," alone
  -- appears twice — in the column list, and inside
  -- round(s.fixed_price_per_carton_mvr, 0) in the carton expression — and
  -- replace() hits every occurrence. The single-line version produced
  -- round(..., s.unit_size, s.unit_size_uom, 0) and a 4-argument round().
  -- Both anchors are counted before use so a near-miss stops rather than
  -- patching something it does not understand.
  v_anchor text := 's.fixed_price_per_carton_mvr,' || chr(10) || '            ll.landed_per_piece_mvr,';
  v_tail   text := '    category_sort_order' || chr(10) || '   FROM priced p;';
  v_hits   int;
begin
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'the column-list anchor matches % times, expected exactly 1', v_hits;
  end if;
  v_hits := (length(v_def) - length(replace(v_def, v_tail, ''))) / length(v_tail);
  if v_hits <> 1 then
    raise exception 'the select-list tail anchor matches % times, expected exactly 1', v_hits;
  end if;

  v_def := replace(v_def, v_anchor,
    's.fixed_price_per_carton_mvr,' || chr(10) ||
    '            s.unit_size,' || chr(10) ||
    '            s.unit_size_uom,' || chr(10) ||
    '            ll.landed_per_piece_mvr,');

  -- Appended at the very END: create or replace view may only ADD columns,
  -- never insert one mid-list.
  v_def := replace(v_def, v_tail,
    '    category_sort_order,' || chr(10) ||
    '    unit_size,' || chr(10) ||
    '    unit_size_uom' || chr(10) ||
    '   FROM priced p;');

  execute 'create or replace view public.v_skus as ' || v_def;
  -- pg_get_viewdef returns the query and NOT the options, so every rebuild
  -- drops security_invoker (0230). Put it back in the same breath.
  execute 'alter view public.v_skus set (security_invoker = on)';
end $mig$;

-- ══════════════════════════════════════════════════════════════════════════
-- A PER-100ML RIVAL PRICE BECOMES COMPARABLE
-- ══════════════════════════════════════════════════════════════════════════
-- Their price is per 100 ml. One of our bottles holds 700, so a bottle-for-
-- bottle equivalent from them is price x 7. That lands on price_per_piece,
-- which for these products IS the bottle (pcs_per_pack is 1), so it flows into
-- every comparison already built with no special case anywhere.
--
-- It stays 'uncomparable' when we do not know our own size, or when the units
-- do not match — a per-100g price against a product measured in ml is not a
-- comparison, it is a coincidence.

create or replace view public.v_competitor_price_normalized
with (security_invoker = on) as
  with our_size as (
    -- One row per variant. Sosoft is one SKU per variant; where a variant ever
    -- holds two, they are two pack formats of the SAME liquid, so the net
    -- content of one piece is the same figure either way.
    select variant_id, max(unit_size) as unit_size, max(unit_size_uom) as unit_size_uom
    from public.skus
    where unit_size is not null
    group by variant_id
  )
  select
    cp.id,
    cp.competitor_id,
    c.name as competitor_name,
    cp.variant_id,
    cp.price_mvr,
    cp.price_basis,
    cp.observed_date,
    cp.their_pcs_per_pack,
    cp.their_packs_per_carton,
    case
      when cp.price_basis = 'per_carton'              then 'carton'
      when cp.price_basis in ('per_piece','per_pack') then 'shelf'
      when cp.price_basis = 'per_100ml' and os.unit_size_uom = 'ml' then 'shelf'
      when cp.price_basis = 'per_100g'  and os.unit_size_uom = 'g'  then 'shelf'
      else 'uncomparable'
    end as buys_like,
    case cp.price_basis
      when 'per_piece'  then cp.price_mvr
      when 'per_pack'   then cp.price_mvr / nullif(cp.their_pcs_per_pack, 0)
      when 'per_carton' then cp.price_mvr
                             / nullif(cp.their_pcs_per_pack * cp.their_packs_per_carton, 0)
      when 'per_100ml'  then case when os.unit_size_uom = 'ml'
                                  then cp.price_mvr * os.unit_size / 100.0 end
      when 'per_100g'   then case when os.unit_size_uom = 'g'
                                  then cp.price_mvr * os.unit_size / 100.0 end
      else null
    end as price_per_piece
  from public.v_competitor_prices_current cp
  join public.competitors c on c.id = cp.competitor_id
  left join our_size os on os.variant_id = cp.variant_id;

comment on view public.v_competitor_price_normalized is
  'The ONE place a competitor price becomes a per-piece number. Read this; '
  'never re-derive it. buys_like separates a shelf price from a carton rate — '
  'a carton is discounted per piece, so mixing them makes our margin read '
  'worse than it is (0223). per_100ml/per_100g join our own net content and '
  'stay uncomparable until it is known (0232).';

grant select on public.v_competitor_price_normalized to authenticated, service_role;

do $$
declare
  v_n int;
  v_bad text;
begin
  select count(*) into v_n from public.skus where unit_size = 700 and unit_size_uom = 'ml';
  if v_n <> 5 then raise exception 'expected 5 bottles at 700ml, found %', v_n; end if;

  if (select count(*) from public.v_skus where unit_size = 700) <> 5 then
    raise exception 'v_skus does not carry the net content';
  end if;

  select string_agg(c.relname, ', ') into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and not exists (select 1 from unnest(coalesce(c.reloptions, '{}')) o
                     where o in ('security_invoker=on', 'security_invoker=true'));
  if v_bad is not null then
    raise exception 'view(s) bypass row level security after the rebuild: %', v_bad;
  end if;
end $$;
