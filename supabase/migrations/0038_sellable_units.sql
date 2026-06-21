-- ============================================================================
-- 0038 — Sellable units (which tiers a product can be sold in)
-- ============================================================================
-- pricing-sales-expert doctrine: "which tiers a product sells in" is a per-SKU
-- property with a per-CATEGORY default. Diapers sell as pack + carton; liquid/
-- powder detergent sell carton-only. The pricing form and sales-order entry read
-- this so they only ever show the tiers that actually exist for a product
-- (no confusing empty pack fields on a case-only SKU).
--
-- db-schema-expert verdict: TEXT[] + CHECK is the right storage for a tiny fixed
-- vocabulary (piece | pack | carton). 'piece' is allowed for future loose-unit
-- sales but unused today. The DB enforces non-empty + subset-of-allowed so bad
-- data is impossible regardless of app bugs.
--
-- 'piece' here = costing/stock atom is always pieces (unchanged); this column is
-- only about what tiers the customer may BUY, not how cost is computed.
-- ----------------------------------------------------------------------------

-- ── 1. Category-level default ───────────────────────────────────────────────
alter table product_categories
  add column if not exists default_sellable_units text[] not null default '{pack,carton}';

alter table product_categories
  drop constraint if exists product_categories_default_sellable_units_chk;
alter table product_categories
  add constraint product_categories_default_sellable_units_chk
  check (
    array_length(default_sellable_units, 1) >= 1
    and default_sellable_units <@ array['piece','pack','carton']::text[]
  );

-- Detergent is sold by the case only (owner's rule).
update product_categories
  set default_sellable_units = '{carton}'
  where name in ('Liquid Detergent', 'Powder Detergent');

-- ── 2. Per-SKU sellable units ───────────────────────────────────────────────
alter table skus
  add column if not exists sellable_units text[] not null default '{pack,carton}';

alter table skus
  drop constraint if exists skus_sellable_units_chk;
alter table skus
  add constraint skus_sellable_units_chk
  check (
    array_length(sellable_units, 1) >= 1
    and sellable_units <@ array['piece','pack','carton']::text[]
  );

-- ── 3. Backfill existing SKUs from their category default ────────────────────
-- Idempotent: re-running just re-applies the category default. Safe to repeat.
-- Join path: skus → variants → product_models → product_categories.
update skus s
  set sellable_units = pc.default_sellable_units
  from variants v
  join product_models m on m.id = v.model_id
  join product_categories pc on pc.id = m.category_id
  where v.id = s.variant_id;

-- ── 4. Expose on v_skus ──────────────────────────────────────────────────────
-- The live v_skus (migration 0013) selects EXPLICIT columns, not s.*, so the new
-- column is NOT picked up automatically — recreate the view with the two new
-- columns APPENDED at the end (CREATE OR REPLACE requires existing output columns
-- unchanged + in the same order; appending is allowed). Body is byte-for-byte the
-- 0013 definition plus the two trailing columns.
create or replace view v_skus as
with latest_landed as (
  select distinct on (sku_id)
    sku_id,
    landed_per_piece_mvr
  from v_batch_stock
  where qty_pieces_remaining > 0
  order by sku_id, received_at desc
)
select
  s.id,
  s.variant_id,
  s.internal_code,
  s.supplier_barcode,
  s.pcs_per_pack,
  s.packs_per_carton,
  (s.pcs_per_pack * s.packs_per_carton)::integer as pcs_per_carton,
  s.carton_length_cm,
  s.carton_width_cm,
  s.carton_height_cm,
  s.carton_weight_kg,
  s.cbm_per_carton,
  s.is_active,
  s.notes,
  s.created_at,
  s.updated_at,
  s.target_margin_pct,
  s.fixed_selling_price_mvr,
  s.fixed_price_per_pack_mvr,
  s.fixed_price_per_carton_mvr,

  ll.landed_per_piece_mvr,

  case
    when s.fixed_selling_price_mvr is not null
      then s.fixed_selling_price_mvr
    when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
      then round(ll.landed_per_piece_mvr / (1 - s.target_margin_pct / 100.0), 2)
    else null
  end as selling_price_per_piece_mvr,

  case
    when s.fixed_price_per_pack_mvr is not null
      then s.fixed_price_per_pack_mvr
    when s.fixed_selling_price_mvr is not null
      then round(s.fixed_selling_price_mvr * s.pcs_per_pack, 2)
    when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
      then round((ll.landed_per_piece_mvr * s.pcs_per_pack) / (1 - s.target_margin_pct / 100.0), 2)
    else null
  end as selling_price_per_pack_mvr,

  case
    when s.fixed_price_per_carton_mvr is not null
      then s.fixed_price_per_carton_mvr
    when s.fixed_selling_price_mvr is not null
      then round(s.fixed_selling_price_mvr * s.pcs_per_pack * s.packs_per_carton, 2)
    when s.target_margin_pct is not null and ll.landed_per_piece_mvr is not null
      then round((ll.landed_per_piece_mvr * s.pcs_per_pack * s.packs_per_carton) / (1 - s.target_margin_pct / 100.0), 2)
    else null
  end as selling_price_per_carton_mvr,

  case
    when s.fixed_selling_price_mvr is not null
      and ll.landed_per_piece_mvr is not null
      and ll.landed_per_piece_mvr > 0
    then round((1 - ll.landed_per_piece_mvr / s.fixed_selling_price_mvr) * 100, 1)
    else null
  end as actual_margin_pct,

  v.attributes,
  v.display_name as variant_display,
  m.id    as model_id,
  m.name  as model_name,
  b.id    as brand_id,
  b.name  as brand_name,
  pc.id   as category_id,
  pc.name as category_name,
  pc.unit_uom,
  pc.cost_basis,
  concat_ws(' › ',
    b.name, m.name, v.display_name,
    s.pcs_per_pack || '×' || s.packs_per_carton
  ) as full_path,

  -- ── New in 0038 (appended) ──
  s.sellable_units,
  pc.default_sellable_units

from skus s
join variants v             on v.id = s.variant_id
join product_models m       on m.id = v.model_id
join brands b               on b.id = m.brand_id
join product_categories pc  on pc.id = m.category_id
left join latest_landed ll  on ll.sku_id = s.id;
