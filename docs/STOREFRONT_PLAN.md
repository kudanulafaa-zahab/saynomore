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

**Not done yet**: no Vercel project exists for `shop/` (needs its own
deployment pointed at that subdirectory, plus the two public env vars —
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — same values
the main app uses); no real domain; product photos are still mostly
missing (placeholder gradient tiles render in their place, by design); the
mixed-carton decision above; and real device testing of the Android install
banner and iOS Safari walkthrough (simulators/sandboxes aren't reliable for
either, per the original verification plan).
