# Customer Storefront — Phase 1 plan (handoff task #6)

**Status: backend built + verified (0112–0118); storefront UI built + verified
in-browser, not yet deployed.** See "Phase 1 UI build" at the bottom of this
doc for what exists in `shop/` and what's still needed before it's live at a
real URL. This is a *separate installable PWA* that touches
customer money and live stock — the highest-risk surface in the system. It's
also the one open task with real product decisions only Ali can make. This doc
pins the plan and those decisions so the build is fast and safe once greenlit,
rather than guessed. It is deliberately backend-first: the money/stock engine is
the hard, dangerous part and belongs in Postgres; the storefront UI is
comparatively routine once the contract is fixed.

## What already exists to build on (verified in-repo, 2026-07-23)

- `sales_orders.order_source` column is live (every row is currently `walk-in`).
  Dispatch and the sales list already read it — a web order just needs to write
  `order_source = 'web'` and it flows through the existing pipeline.
- The proven confirm path: an order is created as `draft`, then `postSale(orderId)`
  deducts stock FIFO atomically at confirmation. Web orders should reuse this,
  **not** a second stock engine.
- Pricing today = each SKU's standard selling price (`v_skus`); `price_lists` is
  empty (0 rows), so there are no customer tiers yet.
- 2 godowns exist, so "which godown fulfils a web order" is a real choice.
- One Supabase project is shared by both apps (the plan all along).

## The 5 decisions needed before building (each blocks a safe default)

1. **Who can order — accounts or guest checkout?** Guest (name + phone + island)
   is fastest to launch and matches how walk-in works today. Accounts add
   re-order history but need customer auth. *Recommend: guest checkout for
   Phase 1.*
2. **What price do web customers pay?** Today there's one price (SKU standard).
   *Recommend: web = standard retail price, server-computed — never trust a
   price from the browser.* Tiers can come later via `price_lists`.
3. **Which godown fulfils web orders?** *Recommend: a single configured
   "web fulfilment" godown for Phase 1* (avoids per-order routing logic).
4. **Do web orders reserve stock at placement, or on staff confirm?**
   *Recommend: land as `draft` (order_source='web') and let staff confirm via
   the existing flow* — so a human checks availability/fraud before stock and
   money commit, and we reuse the proven `postSale` FIFO path. "Atomic" then
   means the order+lines are written in one transaction; stock still commits
   only at confirm.
5. **Payment for Phase 1?** Handoff says COD / bank transfer first; cards later
   (needs a BML merchant account). *Recommend: COD + transfer-with-proof-upload,
   mirroring the existing order payment fields.*

## Build order once decisions are set

1. **`place_customer_order(payload)` RPC** (SECURITY DEFINER, `search_path`
   pinned, anon **granted** here — this is the one intentionally public write,
   so it must validate hard): validate each SKU is active and orderable, price
   every line server-side from `v_skus`, create the `sales_order`
   (`order_source='web'`, `status='draft'`) + lines in one transaction, return
   the order number. No stock touched. Rate-limit / captcha at the edge.
2. **Storefront PWA** (separate Next.js app, same Supabase): catalogue of
   orderable SKUs, cart, guest checkout (name/phone/island), COD/transfer,
   order-placed confirmation. Sosoft sells by carton of 6 (mix or single colour)
   — the mixer UI from the internal app is the reference.
3. **Dispatch surfacing:** web drafts already appear (order_source='web'); add a
   small "Web" badge so staff spot them, then confirm as normal.
4. Cards/BML, customer accounts + re-order, and price tiers are Phase 2+.

## Why this isn't built yet (honest note)

Everything above the RPC needs Ali's five answers, and the customer-money path
must not ship on assumptions — a storefront that misprices or oversells is worse
than no storefront. Tasks #1–#5 were self-contained and shipped to production
this session; #6 is a genuine product, scoped here and ready to build the moment
the decisions land.

## Progress update (2026-07-29)

The 5 decisions above are locked in and the backend they unblock is **built,
verified, and live** — see `/root/.claude/plans/iridescent-jingling-mitten.md`
for the full architecture (separate Next.js project decided over a route
group) and migrations `0112`–`0117` for the implementation:
`get_storefront_catalogue()` (public catalogue read), `place_customer_order()`
(the one public write, no price parameter — server prices every line),
`godowns.is_web_fulfilment`, `variants.image_url` + `product-images` bucket,
and `order_source`/Web badges surfaced in Sales and Dispatch.

Photo upload is live: staff attach a photo to any variant from Products →
Edit Variant → Upload photo (see `EditVariantDialog` in
`components/products/edit-dialogs.tsx`). No admin tool for images is needed
beyond this.

**Product decisions confirmed by Ali, for when the storefront UI is built:**
- MamyPoko "X-tra Dry" = the existing "Xtra Kering" model under newer
  packaging, not a separate model — new images attach to the existing model's
  variants.
- Sosoft colour → scent mapping (confirmed 2026-07-29): Blue = Rose &
  Waterlily, Purple = Freesia & Pear, Red = Sakura Blossom, Pink = Sweet
  Peony, Green = Floral Lily (no photo yet). **Cleaned up 2026-07-29**: the
  catalogue had 4 orphan variant rows alongside the real ones (Purple/Peony,
  Red/Peony, Blue/Mint, and a duplicate spelling of Purple/Fresia&Pear) —
  verified each had zero SKU, stock, or order history before deleting (audit
  logged), and fixed the typo on the live Purple variant in place
  ("Fresia &Pear" → "Fresia & Pear"). Sosoft now has exactly 5 variants, one
  per model, matching the list above 1:1.
- **Browse structure**: category-first (Diapers, Detergent — matches
  `product_categories.sort_order`), brand-grouped within each category
  (MamyPoko/Merries/etc. under Diapers; Sosoft under Detergent), sizes/scents
  nested under each brand — the same grouping rule already mandated
  everywhere else in this app (CLAUDE.md: "product lists stay grouped by
  product"). This is also standard mobile FMCG-storefront practice (category
  tabs, brand sections within).
- **Brand descriptions**: yes, short ones per brand, written from real public
  brand facts (not copied marketing copy) — draft copy below, ready to drop
  into the storefront when it's built:
  - **Merries (Kao, Japan)** — Japan's No.1 diaper brand. 3-Layer Air-Through
    System vents heat and moisture while locking liquid away; the wavy inner
    sheet cuts skin contact by half. Dermatologically tested, fragrance-free.
  - **MamyPoko (Unicharm)** — X-tra Kering's X-shaped absorbent core pulls
    wetness away fast for up to 10 hours dry; the gel core expands 40x, and a
    colour-change wetness line takes the guesswork out of change time.
  - **Sosoft (Wings, Indonesia)** — a 2-in-1 plant-based detergent and fabric
    softener, first in Indonesia to soften with real aloe vera. BotaniBlend
    keeps up to 90% plant-based actives, in five scents shoppers can mix and
    match into one carton.
- **Image quality**: every photo must read crisp on a Retina phone screen —
  source images processed at 1200×1200 (enough headroom for a ~400px CSS
  product card at 3x); the storefront build will additionally use
  `next/image` with proper `sizes`/srcset rather than a single fixed-width
  `<img>`, so the browser picks the right resolution per device.

## Phase 1 UI build (2026-07-29)

Built as `shop/` — a sibling Next.js 16 app inside this same repo (its own
`package.json`/lockfile/config, not a workspace of the root app), matching
the plan's "separate project, same Supabase" decision without needing a
second GitHub repo. Ships: category-tabbed browse (Diapers/Liquid
Detergent/Dishwashing — grouped by brand → model → variant, never a flat
list), product detail with unit picker, cart (localStorage, guest — no
accounts), checkout (COD/bank transfer), order confirmation, and the install
tutorial (Android `beforeinstallprompt` button; iOS Share→Add to Home
Screen walkthrough; detects Instagram/Facebook/TikTok's in-app browser and
tells people to open in Safari first, since Add to Home Screen silently
doesn't work there). Design tokens copied wholesale from `app/globals.css`
(it's pure design-system CSS, no business logic entangled) so it looks like
the same product family.

**Caught while building, fixed same session (migration 0118)**: the
catalogue read had no concept of an age-restricted category. A `Tobacco`
category exists in this database (0 active SKUs today, so nothing was
actually exposed) but nothing stopped it from appearing in the guest
self-serve shop the moment a tobacco SKU went active — no age gate exists
or could exist in a no-account checkout. Added
`product_categories.storefront_visible` (default true, false for Tobacco)
and filtered on it in `get_storefront_catalogue()`. A future restricted
category is a one-row flip, not a new migration.

**Scope cut, not a bug**: Sosoft SKUs' `sellable_units` is `['carton']`
only (no `piece`) — `place_customer_order` validates `uom` against that
list, so a shopper buys a whole carton (6 bottles) of ONE scent per line.
The internal app's "mix your own carton" (different scents in one carton)
is a per-piece-across-SKUs concept the current RPC signature can't express
without a real change to its qty/pricing logic — deferred rather than
half-built. Flagged to Ali; not yet decided whether Phase 1 ships without
it or waits for the RPC extension.

**Verified**: `npx tsc --noEmit`, `npm run build`, and `eslint` all clean
(one pre-existing-pattern warning, matching the main app's own parked
`react-hooks/set-state-in-effect` call). Full flow exercised in a real
browser (Playwright, iPhone viewport) against this sandbox's dev server:
browse → category switch → product page → add to cart (install sheet
fires, iOS walkthrough content correct) → cart (pricing correct) →
checkout (payment method toggle, bank-transfer instructions) → order
placed → confirmation page (order number shown, second install-sheet
chance fires). The `place_customer_order` payload the app actually sent was
captured and matches the RPC's real signature exactly, with no price field.
Note: this sandbox's outbound proxy resets Chromium's connections to
`supabase.co` specifically (confirmed via `curl` through the same proxy
with the same anon key — that returns real data fine, so it's a headless-
browser-in-this-sandbox quirk, not an app bug); the catalogue fetch itself
was verified for real via curl, and the full click-through flow was
verified by intercepting that one request with the real captured response
so the rest of the app's own code — parsing, grouping, cart math, checkout
wiring — was still genuinely exercised end to end.

**Not done yet** (as of the deploy below): product photos are still mostly
missing (placeholder gradient tiles render in their place, by design); the
mixed-carton decision above; real device testing of the Android install
banner and iOS Safari walkthrough (simulators/sandboxes aren't reliable for
either); no real domain (see deploy section).

## Deployed (2026-07-30)

Live in production: **https://saynomore-shop.vercel.app**

- Vercel project `saynomore-shop`, id `prj_oB9tek3qFUxK4qHJFopQhjIMY6aG`, same
  team as the main app (`team_qyYXhgTXNYb5dCxNgfIMmQxk`).
- **Not git-linked** — this session's Vercel MCP access only exposes a
  file-upload deploy tool (`deploy_to_vercel`), not "create project from
  GitHub repo with a custom root directory." So pushes to `shop/**` on
  `main` do **not** auto-deploy the shop, unlike the main app. Two ways to
  fix, either works: (a) in the Vercel dashboard, connect the
  `saynomore-shop` project to this GitHub repo and set **Root Directory**
  to `shop` (one-time, a few clicks, needs a human with dashboard access —
  not something this session's tools can do), or (b) keep redeploying via
  `deploy_to_vercel` with the current `shop/` file contents after each
  change (what this session did — works, just manual).
- **No env vars configured in Vercel's dashboard for this project** — same
  root cause as above (no API access to set them). Worked around instead:
  `shop/next.config.ts`'s `env` block bakes in
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` as fallback
  defaults. This is safe (anon/publishable key, not a secret — RLS +
  the SECURITY DEFINER functions are the actual gate) but means: if the
  Supabase anon key is ever rotated, it must be updated in this file too,
  not just the dashboard.
- `shop/app/globals.css` is a **hand-trimmed subset** of the main app's
  file (~350 lines vs ~1800) — same token names/values, just the ones
  `shop/`'s own components actually reference (verified by grep before
  trimming). This was a bootstrap-payload-size decision, not a design
  decision — see the file's own header comment. If a future shop page
  needs a class/token that only exists in the full staff-app file (e.g.
  the palette switcher, `.glass-panel`, `.pill-*`), copy it back in from
  `app/globals.css` rather than reinventing it.
- Domain: **not purchased** (Ali said hold). Checked and available:
  `saynomoreshop.com` for $11.25/yr via Vercel's registrar. `saynomore.shop`
  is taken. `.mv` isn't supported by Vercel's registrar — would need a
  Maldivian registrar directly, outside this session's tools.

## Next session: in-flight requirements, none built yet

Ali gave a large batch of real requirements in chat (2026-07-30) — plan
agreed for most of it, but **zero code written yet**. Pick up here:

1. **Curated hierarchy** (display-only, no data changes): default/first
   tab = Diapers, Mamypoko brand rendered before Merries within it.
   Mamypoko shows only 3 of its models — **Xtra Kering displayed as "Xtra
   Care"**, **Skin Comfort**, **Royal Soft** (Royal Soft/Royal Soft Boy/
   Royal Soft Girl — Ali said leave as-is, don't merge, just don't
   specially curate them either). Merries shows only **Good Skin** (not
   "Extra Care"). Mamypoko's plain "Diaper" (NB) model excluded too.
   Category label "Liquid Detergent" displays as **"Washing Detergent"**.
   All of this is a client-side display/curation layer in `shop/` — the
   underlying `brands`/`product_models`/`product_categories` names stay
   exactly as your team already knows them in Products; nothing in
   `get_storefront_catalogue()` needs to change for this part.
2. **Phasing out Royal Soft / Skin Comfort**: no new engineering — told
   Ali to just flip `is_active` off on those SKUs from Products once
   stock depletes. `get_storefront_catalogue()` already filters
   `WHERE s.is_active`, so they vanish from the shop immediately, for
   free. Nothing to build.
3. **Seasonal products, general mechanism**: add
   `product_models.is_seasonal boolean not null default false` (new
   migration; propagate through `get_storefront_catalogue()`'s return
   columns). Any model, any brand, any category can be marked seasonal
   from Products (needs a toggle added to `EditModelDialog` in
   `components/products/edit-dialogs.tsx`, same pattern as other
   booleans there). Storefront: a **second tab, right after Diapers**
   (before Washing Detergent), synthesized client-side by pulling every
   `is_seasonal` model out of whatever category/brand it's actually in —
   it is NOT a fixed category. Confirmed with Ali: Mamypoko is the most
   prominent thing on the shop (first tab, first brand); Seasonal is
   next-most prominent (second tab), not above Mamypoko.
4. **Mixed-carton-of-6 for guests** (Sosoft, and any future
   `mixed_carton_pieces` brand): real backend change, not just UI —
   `place_customer_order` currently rejects `uom='piece'` for these SKUs
   because `sellable_units` only contains `'carton'`. Design agreed:
   inside the function, when a line's `uom='piece'` AND the SKU's brand
   has `mixed_carton_pieces` set, allow it (bypass the strict
   `sellable_units` check for this one case only), price it at
   `selling_price_per_carton_mvr / pcs_per_carton` per piece, then AFTER
   the line loop, group all such piece-lines by brand and reject the
   whole order if any brand's total piece qty isn't an exact positive
   multiple of that brand's `mixed_carton_pieces` — mirrors exactly what
   the internal `MixedCartonSheet` already does for staff, just opened up
   to guests. Storefront UI: on the Washing Detergent tab, **"Mix your own
   carton" is the first/default option**, ahead of single-colour cartons;
   the picker must block submission until the 6 pieces are chosen.
5. **The Body Shop lotion (seasonal)**: nothing created yet — new brand
   ("The Body Shop"), new category (lotion doesn't fit any existing
   category's `unit_uom`/`cost_basis`; recommended a new "Body Care"
   category, `cost_basis='piece'` like Diapers, `variant_attributes:
   ['scent']` like Sosoft), one model with `is_seasonal=true`, 4 scent
   variants. **Blocked on real facts from Ali, do not invent them**: the
   4 scent names, selling price (or target margin + landed cost once
   stock lands), whether stock exists yet or this is a "coming soon"
   listing, pack/carton config (loose bottles vs packs), and photos (ships
   with the placeholder tile if none yet, same as everything else).
6. **Homepage copy — drafted, not yet confirmed or placed on the page**:
   three tone options were given for the "why we're cheaper" section
   (recommended: warm/community option for the hero, punchier option as a
   pull-quote elsewhere) — Ali hadn't picked one as of the chat-migration
   request. Also drafted and pending placement: hero headline options,
   "Why SayNoMore" brand story, the MamyPoko colour-market explainer
   (dark blue = India-market packaging; ours is yellow = genuine
   Malaysia/Indonesia-market packaging — deliberately worded to explain,
   never to accuse other sellers of anything, for legal safety), category
   intros, a real price-comparison table for MamyPoko Xtra Kering built
   from Ali's own logged competitor data (26–48% cheaper per piece
   depending on size — per-piece, not per-pack, since pack counts differ
   between sellers) with a recommendation to **never name the competitor
   publicly** (logged internally as "VB"), delivery/trust copy, and a
   short list of suggested additions (a real trust stat if Ali has one, a
   "how it works" strip, a confirmation-screen expectation-setting line,
   a brand-logo trust strip). All of this text exists only in chat so
   far — nothing has been written into `shop/` yet.
