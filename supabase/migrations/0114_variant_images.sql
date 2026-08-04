-- 0114 — Product photos: one per variant, plus the storage bucket to hold them.
--
-- Zero image/photo columns exist anywhere in the product schema today
-- (verified: grep for image|photo|thumbnail across every migration returns
-- no hits), and zero Storage buckets exist. This is genuinely new, not reuse.
--
-- The column lives on VARIANTS, not skus: a diaper "size" (variant) is what a
-- customer visually distinguishes and buys. Two skus can differ only in pack/
-- carton configuration (e.g. 3-pack vs 6-pack of the same size) and share the
-- same photo, so keying the photo one level up avoids duplicate uploads for
-- what is visually the same product.
--
-- The bucket is public-READ (these are marketing photos with zero sensitivity
-- — no reason to proxy them through an authenticated request) and
-- authenticated-WRITE only, so only signed-in staff can upload from the
-- existing Products admin screen.

alter table public.variants
  add column if not exists image_url text;

comment on column public.variants.image_url is
  'Public marketing photo for this variant (one photo per visually distinct '
  'size/scent/colour). Nullable — most variants will launch without one; the '
  'the UI must render a clean placeholder, not a broken-image icon.';

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product-images staff write" on storage.objects;
create policy "product-images staff write"
  on storage.objects for insert
  with check (bucket_id = 'product-images' and (select auth.role()) = 'authenticated');

drop policy if exists "product-images staff update" on storage.objects;
create policy "product-images staff update"
  on storage.objects for update
  using (bucket_id = 'product-images' and (select auth.role()) = 'authenticated');

drop policy if exists "product-images staff delete" on storage.objects;
create policy "product-images staff delete"
  on storage.objects for delete
  using (bucket_id = 'product-images' and (select auth.role()) = 'authenticated');
