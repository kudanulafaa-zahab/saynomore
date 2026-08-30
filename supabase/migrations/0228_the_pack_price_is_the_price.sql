-- 0228 — the PACK price is the price. Per-piece is derived from it.
--
-- Ali, 2026-08-30:
--   *"For all diapers can you make sure the price is calculated in packs and
--    cartons? Nobody will sell diapers in pieces. All the math related must be
--    correct. All diaper SKUs must follow it. The only reason I need per piece
--    pricing is because competitor pack count is different."*
--
-- ── THE MODEL WAS UPSIDE DOWN ─────────────────────────────────────────────
--
-- v_skus took fixed_selling_price_mvr — a PER-PIECE number — as the base, and
-- built the pack price up from it. So the number Ali actually decides (what a
-- pack sells for) was stored as a fraction of itself and multiplied back:
--
--   he types      160 a pack
--   stored        160 / 44 = 3.64          (two decimals, precision gone)
--   read back     round(3.64 x 44) = 160   (works by luck; 160.16 rounds down)
--   per piece     round(3.64, 0) = 4.00    (9.9% high, and nobody pays it)
--
-- Worse, the pack price ALSO has its own column, so the same product can hold
-- two prices that disagree. Six X-Tra Kering SKUs do, by about 8%:
--
--   MAMY-XTRA-L-42x4    pack 215   per-piece implies 199.08   +15.92
--   MAMY-XTRA-M-48x4    pack 215   per-piece implies 199.20   +15.80
--   MAMY-XTRA-S-56x4    pack 215   per-piece implies 198.80   +16.20
--   MAMY-XTRA-XL-38x4   pack 225   per-piece implies 207.10   +17.90
--   MAMY-XTRA-XXL-34x4  pack 225   per-piece implies 207.06   +17.94
--   MAMY-XTRA-XXXL-32x3 pack 270   per-piece implies 254.08   +15.92
--
-- Which of the two won depended on which screen you were looking at.
--
-- ── THE FIX: ONE DIRECTION OF TRAVEL ──────────────────────────────────────
--
-- The pack price is the price. Per-piece becomes exactly pack / pcs_per_pack,
-- at full precision, and is never independently decided. It exists for one
-- reason and Ali named it: rivals sell 30s, 34s, 48s, so a per-piece figure is
-- the only way to compare their pack against ours.
--
-- Each branch below is the matching branch of selling_price_per_pack_mvr
-- divided by pcs_per_pack, so the two cannot drift by construction. The pack
-- expression keeps its whole-rufiyaa rounding, because whole rufiyaa is what
-- he charges; the division that follows is exact, because nobody charges it.
--
-- ── WHAT MOVES: NOTHING HE CHARGES ────────────────────────────────────────
--
-- Measured across the whole catalogue before applying:
--
--   pack prices moved      0
--   carton prices moved    0
--   margins moved          0
--   per-piece figures      26 corrected
--
-- The one product with a single-unit pack that changes is Sosoft Blue, whose
-- per-piece was NULL because it had a pack price and no per-piece price — the
-- only colour of five without one. It now reads 37.00 like its siblings. Its
-- 47 bottles all sold at 36.6667, the carton rate, so the null was latent
-- rather than live: the mixed-carton flow prices off the carton, never off
-- this column.
--
-- Margins were already safe: actual_margin_pct picks pack or carton via
-- margin_unit(sellable_units) and has never used the piece tier (0139).

do $mig$
declare
  v_old text := $old$                CASE
                    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr, 0)
                    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr / (1::numeric - s.target_margin_pct / 100.0), 0)
                    ELSE NULL::numeric
                END AS selling_price_per_piece_mvr,$old$;
  v_new text := $new$                CASE
                    WHEN s.fixed_price_per_pack_mvr IS NOT NULL THEN round(s.fixed_price_per_pack_mvr, 0) / s.pcs_per_pack::numeric
                    WHEN s.fixed_selling_price_mvr IS NOT NULL THEN round(s.fixed_selling_price_mvr * s.pcs_per_pack::numeric, 0) / s.pcs_per_pack::numeric
                    WHEN s.target_margin_pct IS NOT NULL AND ll.landed_per_piece_mvr IS NOT NULL THEN round(ll.landed_per_piece_mvr * s.pcs_per_pack::numeric / (1::numeric - s.target_margin_pct / 100.0), 0) / s.pcs_per_pack::numeric
                    ELSE NULL::numeric
                END AS selling_price_per_piece_mvr,$new$;
  v_def text := pg_get_viewdef('public.v_skus'::regclass, true);
begin
  -- Patched rather than retyped: v_skus is 5,800 characters and reproducing it
  -- by hand to change four lines is how a column gets silently dropped. If the
  -- expression is ever not the one this was written against, it stops rather
  -- than patching something it does not understand.
  if position(v_old in v_def) = 0 then
    raise exception 'the per-piece expression is not the one 0228 was written against — refusing to patch a view it does not recognise';
  end if;
  execute 'create or replace view public.v_skus as ' || replace(v_def, v_old, v_new);
end $mig$;

do $$
declare
  v text := pg_get_viewdef('public.v_skus'::regclass, true);
  v_bad int;
begin
  if v !~ 'fixed_price_per_pack_mvr, 0\) / s\.pcs_per_pack' then
    raise exception 'the per-piece price is not derived from the pack price';
  end if;
  -- The invariant, checked against the real catalogue rather than asserted:
  -- every priced SKU's per-piece figure is exactly its pack price divided by
  -- the pack size. Nothing rounded, nothing independent.
  select count(*) into v_bad
    from public.v_skus
   where selling_price_per_pack_mvr is not null
     and pcs_per_pack > 0
     and round(selling_price_per_piece_mvr, 6)
         is distinct from round(selling_price_per_pack_mvr / pcs_per_pack::numeric, 6);
  if v_bad > 0 then
    raise exception '% product(s) still price a piece independently of the pack', v_bad;
  end if;
end $$;
