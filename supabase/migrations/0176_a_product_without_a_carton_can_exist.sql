-- 0176 — a product without a carton can exist.
--
-- Ali, 2026-08-11, with a screenshot: "Can't create bodybutter."
--
--   duplicate key value violates unique constraint
--   "variants_model_id_attributes_key"
--
-- THAT ERROR WAS A SYMPTOM, NOT THE CAUSE.
--
-- skus.carton_length_cm / width / height were NOT NULL with CHECK (> 0). The
-- form had 0, 0, 0 — correct, because a body butter tub carried home in a
-- suitcase has no carton and no dimensions to measure.
--
-- So the sequence was:
--   1. brand "Bodyshop"     inserted   OK
--   2. model "Dewberry"     inserted   OK
--   3. variant (attrs {})   inserted   OK
--   4. the SKU itself       REJECTED by carton_length_cm > 0
--   5. nothing rolled back
--
-- Every retry then hit the variant's unique (model_id, attributes) first and
-- reported THAT, hiding the real reason. Confirmed in production: brand, model
-- and variant all existed, with zero SKUs under them.
--
-- WHY THE CHECK MOVES RATHER THAN DISAPPEARS
--
-- CBM is load-bearing: confirm_grn splits freight and local charges across
-- shipment lines by each line's share of it, and a zero would silently give a
-- line free freight. Worth protecting — but it was being enforced in the wrong
-- place. A SKU is a product; a CBM is a fact about shipping one. Demanding
-- dimensions at CREATION blocks anything that will never travel in a
-- container, and invites the far worse outcome of someone typing 10 x 10 x 10
-- to get past the form, corrupting the freight split of every real import it
-- later appears on.
--
-- The guard that matters already sits exactly where it should: shipment_lines
-- has CHECK (cbm_per_carton > 0), so a zero-CBM line still cannot exist and
-- hard rule 4 is untouched. Nothing about importing changes.
--
-- NULL now means "not measured" — the truth for a hand-carried tub — and stays
-- distinguishable from a measured zero, which remains impossible.

alter table skus
  alter column carton_length_cm drop not null,
  alter column carton_width_cm  drop not null,
  alter column carton_height_cm drop not null;

alter table skus drop constraint if exists skus_carton_length_cm_check;
alter table skus drop constraint if exists skus_carton_width_cm_check;
alter table skus drop constraint if exists skus_carton_height_cm_check;

alter table skus add constraint skus_carton_length_cm_check
  check (carton_length_cm is null or carton_length_cm > 0);
alter table skus add constraint skus_carton_width_cm_check
  check (carton_width_cm  is null or carton_width_cm  > 0);
alter table skus add constraint skus_carton_height_cm_check
  check (carton_height_cm is null or carton_height_cm > 0);

comment on column skus.carton_length_cm is
  'Carton dimension in cm, or NULL when the product has no carton to measure '
  '(bought locally, carried in). CBM is generated from the three dimensions '
  'and is only required at SHIPMENT LINE level, where freight is apportioned '
  'by it — see shipment_lines.cbm_per_carton > 0.';
