-- 0179 — the facts we are allowed to state about a product.
--
-- Ali, 2026-08-13: "I need you to source reliable information from actual
-- websites for my products and use them to create content. Important note: do
-- not assume we're only targeting baby products. In future we will have a whole
-- range of diverse products."
--
-- WHAT THIS IS FOR. Marketing content, the size-up prompt, and the education
-- messages all need to say something TRUE about a product. Left to itself, a
-- generator will happily write "extra soft and gentle" about a bottle of
-- dishwashing liquid. This table is the constraint that stops it: nothing may be
-- claimed about a product unless a row here says so, and every row carries the
-- source it came from and the date it was checked. A product with no rows gets a
-- photo and a price, never an invented benefit.
--
-- WHY CLAIMS HANG OFF BRAND *OR* MODEL. Sosoft's claims ("Nature+ Technology",
-- no chlorine or paraben) are true of all five bottles; MamyPoko's are not —
-- X-Tra Kering is "2× more elastic" and Skin Comfort is the coconut-oil one, and
-- swapping them would be a lie about a real product. So a claim attaches to
-- exactly one of the two, and the reader returns model claims before brand
-- claims because the specific beats the general.
--
-- WHY THE SIZE LADDER IS DECLARED PER CATEGORY, NOT BUILT INTO DIAPERS. He sells
-- four categories today — Diapers, Liquid Detergent, Bodybutter, Dishwashing —
-- and only one of them has sizes that a customer progresses through. Hardcoding
-- a weight ladder into the product model would make every future category carry
-- a baby's weight around. Instead a category DECLARES whether it has a
-- progression and what it is measured in (`progression_unit`). Diapers say 'kg'.
-- Everything else says nothing, and every screen downstream simply gets null.
--
-- WHY THE LADDER IS PER BRAND. Merries is not MamyPoko. Kao publishes different
-- ranges from Unicharm for the same size letter, so one ladder for "Diapers"
-- would put a Merries baby in a MamyPoko range. brand_id null means "the default
-- for this category", which is right for a category where every brand agrees
-- (shoe sizes, battery sizes) and wrong for this one.
--
-- WHAT IS DELIBERATELY NOT SEEDED. Merries has no ladder and no claims here.
-- Its Indonesian site was unreachable and the figures circulating on resellers'
-- listings disagree with each other, so it stays empty until Ali photographs a
-- carton. Bodyshop and Mama Lime are the same: not researched, therefore not
-- claimed. An empty result is the correct, honest answer and the reader is built
-- to return it cleanly — that is the whole design, not a gap in it.
--
-- SIZES OVERLAP, AND THAT GOVERNS HOW THIS MAY BE USED. MamyPoko's M is 7–12 kg,
-- L is 9–14 and XL is 12–17, so a 12 kg baby is legitimately in three sizes at
-- once. Nothing built on this table may ever tell a parent they are on the wrong
-- size. It may say what a size is for, and it may notice when a customer has
-- gone past the TOP of their current range. Ali, 2026-08-13: educate them "in a
-- way they don't feel they're dumb".

-- ── A category may declare that it has a progression ────────────────────────

alter table product_categories
  add column if not exists progression_unit text,
  add column if not exists progression_noun text;

comment on column product_categories.progression_unit is
  'Unit a customer progresses through for this category, e.g. ''kg'' for diapers. '
  'NULL means the category has no ladder — the normal case.';
comment on column product_categories.progression_noun is
  'What that unit measures, in the words a customer would use, e.g. ''weight''. '
  'NULL whenever progression_unit is NULL.';

alter table product_categories
  drop constraint if exists product_categories_progression_paired;
alter table product_categories
  add constraint product_categories_progression_paired
  check (num_nonnulls(progression_unit, progression_noun) <> 1);

update product_categories
   set progression_unit = 'kg', progression_noun = 'weight'
 where name = 'Diapers';

-- ── The ladder itself ───────────────────────────────────────────────────────

create table if not exists product_size_ladders (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references product_categories(id) on delete cascade,
  brand_id    uuid          references brands(id)             on delete cascade,
  size_label  text    not null,
  min_value   numeric(10,2) not null,
  max_value   numeric(10,2) not null,
  sort_order  integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint product_size_ladders_range_sane check (max_value > min_value),
  -- NULLS NOT DISTINCT so a category can only have ONE default ladder entry per
  -- size. Without it, Postgres treats every null brand_id as unique and the
  -- "default" ladder would silently accept duplicates.
  constraint product_size_ladders_unique
    unique nulls not distinct (category_id, brand_id, size_label)
);

comment on table product_size_ladders is
  'What each size label means, per brand. brand_id NULL = the default for the '
  'category. Ranges overlap on purpose — that is how the manufacturer publishes '
  'them — so this says what a size is FOR, never what size someone should be on.';

create index if not exists product_size_ladders_lookup
  on product_size_ladders (category_id, brand_id, sort_order);

-- ── The claims ──────────────────────────────────────────────────────────────

create table if not exists product_claims (
  id            uuid primary key default gen_random_uuid(),
  brand_id      uuid references brands(id)         on delete cascade,
  model_id      uuid references product_models(id) on delete cascade,
  claim_text    text not null,
  original_text text,
  source_name   text not null,
  source_url    text not null,
  checked_on    date not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint product_claims_one_owner check (num_nonnulls(brand_id, model_id) = 1),
  constraint product_claims_text_real check (length(btrim(claim_text)) > 0),
  constraint product_claims_source_real check (source_url ~ '^https?://')
);

comment on table product_claims is
  'Things we are allowed to say about a product, in the manufacturer''s own '
  'words, each with the source it came from and the date it was checked. '
  'Attaches to a brand (true of the whole range) or a model (true of that one). '
  'No row here, no claim there.';
comment on column product_claims.original_text is
  'The wording as published, before translation. This is the evidence — without '
  'it a translated claim is just an assertion.';

create index if not exists product_claims_model on product_claims (model_id, sort_order);
create index if not exists product_claims_brand on product_claims (brand_id, sort_order);

-- ── Row level security ──────────────────────────────────────────────────────
-- Same shape as recurring_expenses (0167): everyone signed in may read the
-- catalogue; only admin/manager may change what the business is willing to
-- claim in public.

alter table product_size_ladders enable row level security;
alter table product_claims       enable row level security;

drop policy if exists psl_read  on product_size_ladders;
drop policy if exists psl_write on product_size_ladders;
create policy psl_read  on product_size_ladders for select
  using ((select auth.uid()) is not null);
create policy psl_write on product_size_ladders for all
  using (is_admin_or_manager());

drop policy if exists pc_read  on product_claims;
drop policy if exists pc_write on product_claims;
create policy pc_read  on product_claims for select
  using ((select auth.uid()) is not null);
create policy pc_write on product_claims for all
  using (is_admin_or_manager());

drop trigger if exists trg_psl_updated_at on product_size_ladders;
create trigger trg_psl_updated_at before update on product_size_ladders
  for each row execute function set_updated_at();
drop trigger if exists trg_pcl_updated_at on product_claims;
create trigger trg_pcl_updated_at before update on product_claims
  for each row execute function set_updated_at();

-- ── The reader ──────────────────────────────────────────────────────────────
-- One call, everything that may truthfully be said about one SKU. Returns a
-- fully-formed shape even when nothing is known, so no caller has to special-
-- case the empty product — `has_facts` is the single flag to branch on.

create or replace function get_product_facts(p_sku_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with sku as (
  select s.id, v.attributes->>'size' as size_label,
         m.id as model_id, m.name as model_name,
         b.id as brand_id, b.name as brand_name,
         c.id as category_id, c.name as category_name,
         c.progression_unit, c.progression_noun
  from public.skus s
  join public.variants v          on v.id = s.variant_id
  join public.product_models m    on m.id = v.model_id
  join public.brands b            on b.id = m.brand_id
  join public.product_categories c on c.id = m.category_id
  where s.id = p_sku_id
),
-- The brand's own ladder if it has one, otherwise the category default.
-- Never both: a brand that publishes its own ranges must not inherit another's.
ladder as (
  select l.*
  from public.product_size_ladders l, sku
  where l.category_id = sku.category_id
    and l.brand_id is not distinct from (
      select case when exists (
        select 1 from public.product_size_ladders l2
        where l2.category_id = sku.category_id and l2.brand_id = sku.brand_id
      ) then sku.brand_id else null end
    )
),
-- Columns named explicitly: `select *` here would emit size_label twice (once
-- from the ladder, once from the sku) and every later reference to it would be
-- ambiguous.
here as (
  select l.size_label, l.min_value, l.max_value, l.sort_order
  from ladder l, sku
  where l.size_label = sku.size_label
),
claims as (
  select cl.claim_text, cl.original_text, cl.source_name, cl.source_url, cl.checked_on,
         -- model claims first: the specific beats the general
         case when cl.model_id is not null then 0 else 1 end as tier,
         cl.sort_order
  from public.product_claims cl, sku
  where cl.model_id = sku.model_id or cl.brand_id = sku.brand_id
)
select jsonb_build_object(
  'sku_id',        sku.id,
  'brand',         sku.brand_name,
  'model',         sku.model_name,
  'category',      sku.category_name,
  'has_facts',     (exists (select 1 from claims)) or (exists (select 1 from here)),
  'claims',        coalesce((
                     select jsonb_agg(jsonb_build_object(
                       'text',        c.claim_text,
                       'original',    c.original_text,
                       'source',      c.source_name,
                       'url',         c.source_url,
                       'checked_on',  c.checked_on)
                       order by c.tier, c.sort_order)
                     from claims c), '[]'::jsonb),
  'progression',   case when sku.progression_unit is null or not exists (select 1 from here)
                     then null
                     else jsonb_build_object(
                       'unit',  sku.progression_unit,
                       'noun',  sku.progression_noun,
                       'current', (select jsonb_build_object(
                                     'label', h.size_label, 'min', h.min_value, 'max', h.max_value)
                                   from here h),
                       'next',    (select jsonb_build_object(
                                     'label', n.size_label, 'min', n.min_value, 'max', n.max_value)
                                   from ladder n, here h
                                   where n.sort_order > h.sort_order
                                   order by n.sort_order limit 1),
                       'ladder',  (select jsonb_agg(jsonb_build_object(
                                     'label', l.size_label, 'min', l.min_value, 'max', l.max_value)
                                     order by l.sort_order)
                                   from ladder l))
                   end
)
from sku;
$$;

comment on function get_product_facts(uuid) is
  'Everything that may truthfully be said about one SKU: sourced claims (model '
  'first, then brand) and where it sits on its size ladder, with the next size '
  'up. has_facts is false when nothing is known — then the caller shows a photo '
  'and a price and claims nothing.';

-- Least privilege. Supabase grants EXECUTE to `authenticated` by DEFAULT on new
-- functions in public (see 0169), so revoking from anon alone proves nothing —
-- public must go too. Every signed-in role may read the catalogue.
revoke execute on function get_product_facts(uuid) from public;
revoke execute on function get_product_facts(uuid) from anon;
grant  execute on function get_product_facts(uuid) to authenticated;

-- ── Seed: only what was actually read off a manufacturer's own site ─────────
-- Checked 2026-08-14 against id.mamypoko.com and wingscorp.com. The Indonesian
-- wording is kept in original_text so a future reader can check the translation
-- rather than trust it.

insert into product_size_ladders (category_id, brand_id, size_label, min_value, max_value, sort_order)
select c.id, b.id, l.size_label, l.min_value, l.max_value, l.sort_order
from public.product_categories c
join public.brands b on lower(b.name) = 'mamypoko'
cross join (values
  ('NB/S',  3.0, 8.0,  1),
  ('S',     4.0, 8.0,  2),
  ('M',     7.0, 12.0, 3),
  ('L',     9.0, 14.0, 4),
  ('XL',   12.0, 17.0, 5),
  ('XXL',  15.0, 25.0, 6),
  ('XXXL', 18.0, 35.0, 7)
) as l(size_label, min_value, max_value, sort_order)
where c.name = 'Diapers'
on conflict on constraint product_size_ladders_unique do nothing;

insert into product_claims (model_id, claim_text, original_text, source_name, source_url, checked_on, sort_order)
select m.id, x.claim_text, x.original_text, 'MamyPoko Indonesia', 'https://id.mamypoko.com/id/products.html', date '2026-08-14', x.sort_order
from public.product_models m
join public.brands b on b.id = m.brand_id and lower(b.name) = 'mamypoko'
join (values
  ('Xtra Kering',     'Twice as stretchy, so it moves with them',        '2x Lebih Elastis',                                  1),
  ('Xtra Kering',     'Absorbs for up to 14 hours',                      '14 jam',                                            2),
  ('Skin Comfort',    'Coconut oil — guards against rash for 14 hours',  'Coconut Oil yang Mampu 14 Jam Cegah Ruam',          1),
  ('Royal Soft',      'Soft enough to prevent irritation',               'Lembut Cegah Iritasi',                              1),
  ('Royal Soft',      'Holds a lot and still stays thin',                'Serap Banyak & Tetap Tipis',                        2),
  ('Royal Soft Boy',  'Soft enough to prevent irritation',               'Lembut Cegah Iritasi',                              1),
  ('Royal Soft Boy',  'Holds a lot and still stays thin',                'Serap Banyak & Tetap Tipis',                        2),
  ('Royal Soft Girl', 'Soft enough to prevent irritation',               'Lembut Cegah Iritasi',                              1),
  ('Royal Soft Girl', 'Holds a lot and still stays thin',                'Serap Banyak & Tetap Tipis',                        2)
) as x(model_name, claim_text, original_text, sort_order) on m.name = x.model_name
where not exists (
  select 1 from public.product_claims pc2
  where pc2.model_id = m.id and pc2.claim_text = x.claim_text
);

-- Sosoft's claims are true of every bottle in the range, so they hang off the
-- brand rather than being copied onto Blue, Green, Pink, Purple and Red.
-- Which colour is which fragrance is NOT recorded: WINGS publishes Sakura
-- Blossom, Freesia & Pear, Rose & Waterlily and others, and guessing the
-- mapping would put the wrong scent on a real bottle.
insert into product_claims (brand_id, claim_text, original_text, source_name, source_url, checked_on, sort_order)
select b.id, x.claim_text, x.original_text, 'WINGS Group', 'https://wingscorp.com/brand-detail/so-soft-detergent/', date '2026-08-14', x.sort_order
from public.brands b
join (values
  ('Cleans with plant-derived actives',        'Nature+ Technology',            1),
  ('Dermatologically tested, gentle on hands', 'Teruji dermatologis',           2),
  ('No chlorine, no paraben',                  'Tanpa klorin dan paraben',      3),
  ('Concentrated, so a little goes further',   'Deterjen cair konsentrat',      4)
) as x(claim_text, original_text, sort_order) on true
where lower(b.name) = 'sosoft'
  and not exists (
    select 1 from public.product_claims pc2
    where pc2.brand_id = b.id and pc2.claim_text = x.claim_text
  );
