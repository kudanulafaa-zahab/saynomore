-- Shared fixture for pgTAP tests (supabase/tests/database/*.test.sql).
-- Runs once after migrations, before any test file. Fixed UUIDs so test
-- files can reference these rows directly instead of querying them back.
-- Deliberately minimal: one full catalog chain (category -> brand -> model
-- -> variant -> sku), one godown, one supplier -- enough for any test that
-- needs a real SKU to exist, nothing that isn't needed.
--
-- UUIDs are 00000000-0000-0000-0000-0000000000NN, NN counting up -- must
-- stay valid hex (0-9a-f only), which ruled out mnemonic letters like
-- "sku"/"godown" as suffixes.

insert into product_categories (id, name, unit_uom, cost_basis)
values ('00000000-0000-0000-0000-000000000001', 'Test Category', 'pcs', 'piece');

insert into brands (id, name)
values ('00000000-0000-0000-0000-000000000002', 'Test Brand');

insert into product_models (id, brand_id, category_id, name)
values ('00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        'Test Model');

insert into variants (id, model_id, display_name)
values ('00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000003',
        'Test Variant');

-- pcs_per_pack 34, packs_per_carton 3 (mirrors the real SKU-code convention:
-- BRAND-MODEL-SIZE-34x3). Carton 40 x 30 x 30 cm = 0.036 CBM/carton.
insert into skus (id, variant_id, internal_code, pcs_per_pack, packs_per_carton,
                   carton_length_cm, carton_width_cm, carton_height_cm)
values ('00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000004',
        'TEST-MODEL-VARIANT-34x3', 34, 3, 40, 30, 30);

insert into godowns (id, name, is_default)
values ('00000000-0000-0000-0000-000000000006', 'Test Godown', true);

insert into suppliers (id, name, country, invoice_currency)
values ('00000000-0000-0000-0000-000000000007', 'Test Supplier', 'Indonesia', 'USD');
