# Customer Storefront — Phase 1 plan (handoff task #6)

**Status: scoped, not built.** This is a *separate installable PWA* that touches
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
  Peony, Green = Floral Lily (no photo yet). The catalogue currently also
  carries a near-duplicate "Fresia &Pear" variant under Purple and misplaced
  "Peony Bottle 700ml" entries under both Purple and Red — Ali wants to review
  the Products screen himself before anything is cleaned up; **do not delete
  without his go-ahead**.
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

Storefront UI build (Task #3, `saynomore-shop` Next.js project) is still on
hold at Ali's request — not started.
