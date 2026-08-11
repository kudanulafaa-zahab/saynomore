-- 0172 — a unit can be a tub.
--
-- product_categories.unit_uom was limited to 'pcs', 'ml', 'g'. That is why
-- 0171's new nouns were unreachable: unit_noun() could map 'tub' -> "tub", but
-- nothing was ever allowed to BE a tub.
--
-- unit_uom answers "what is one unit of this category" — it drives the noun on
-- every screen and, for detergents, the per-100ml/100g cost basis. For a Body
-- Shop body butter the honest answer is a tub. Restricting the column to three
-- measures was right when the catalogue was diapers and detergent; it is wrong
-- the moment a product is sold as a single item with a name of its own.
--
-- Found the hard way: Ali had ALREADY created a "Bodybutter" category with
-- unit_uom='pcs', which made unit_noun() return 'pack'. Two dozen tubs would
-- have been displayed as "24 packs" on every screen in the app.
--
-- Widened, not replaced: pcs/ml/g keep working exactly as before, and the
-- cost_basis check is untouched — a tub is still cost_basis='piece'.

alter table product_categories drop constraint if exists product_categories_unit_uom_check;

alter table product_categories add constraint product_categories_unit_uom_check
  check (unit_uom = any (array[
    'pcs','ml','g',
    'tub','jar','tube','bar','sachet','bottle','unit'
  ]));

comment on column product_categories.unit_uom is
  'What ONE unit of this category is. A measure (pcs/ml/g) for things counted '
  'or measured, or the item itself (tub/jar/tube/bar/sachet/bottle/unit) for '
  'things sold singly. Drives unit_noun() on every screen, and the '
  'per-100ml/100g cost basis for detergents.';
