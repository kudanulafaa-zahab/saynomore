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
