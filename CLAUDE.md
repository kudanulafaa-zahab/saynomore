@skills.md
# SayNoMore — Project Rules

> **Continuing in a new chat?** Read `docs/HANDOFF.md` first — it carries the
> project/access IDs, the light+dark design system, what's built (migrations to
> 0101), and the open task list so nothing is lost between sessions.

## Behaviour
- Plain English. One recommendation. Lead with the answer.
- Never ask Ali to choose between technical options.
- **Always research current expert/industry best practice before building, and
  apply it** — how professionals actually solve this problem (UI/UX patterns,
  data modelling, finance/inventory conventions), to current standards. Never
  hand-wave, guess, or skimp on details. Build it properly the first time and
  say briefly what standard you applied.

## Stack (locked)
Next.js 16 App Router (Turbopack) · React 19 (React Compiler ON) · TypeScript strict · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres) · Vercel · Lucide icons

## Design
- Light/dark adaptive: use CSS vars (`var(--foreground)`, `var(--background)`, `var(--glass-1)`, `var(--glass-2)`, `var(--muted-foreground)`, `var(--glass-border)`) — never hardcode hex colours
- Primary action buttons: `background: var(--foreground)` / `color: var(--background)`
- Cards: `background: var(--glass-1)` with `backdropFilter: blur(20px)`
- Responsive grids: Tailwind classes (`grid-cols-1 sm:grid-cols-3`) not inline `gridTemplateColumns`
- No decorative watermark icons behind content
- **Product lists stay grouped by product — always (Ali's standing rule).** Any list
  of SKUs (Inventory, Price Book, …) must keep its product structure: each product
  (brand · model) is its own section; a detergent must never appear between two diaper
  SKUs. Sorting/ranking reorders the **sections** (and the sizes within a section),
  **never** the SKUs flattened across the whole catalogue. No flat cross-product list.

### Scroll ownership (one scroll container per screen)
- The **page scrolls**, not inner panes. The app shell (`app/(app)/layout.tsx`) already scrolls the document (`min-h-dvh`, normal-flow `<main>`). In-page lists/grids must just flow — **never** wrap in-page content in `height: calc(100vh…)` + `overflow-y-auto`. That creates nested double-scroll (a list that scrolls inside a page that also scrolls).
- **Only exception:** a full-screen takeover (`fixed inset-0`) — modal, bottom sheet, full-screen editor. Those own their scroll because they're a layer *over* the page. They may use `overflow-y-auto` + `overscroll-contain`.
- **Never `100vh`** (it ignores the iOS dynamic toolbar). Full-screen layers use `100dvh`; in-page content uses no fixed height at all.
- Desktop split-panes (side-by-side list+detail) may own inner scroll with a fixed `100dvh`-based height, but that layout must be `lg:` only — mobile flows in the page.

## Migrations
Claude is authorized to write and apply new migrations directly via the Supabase MCP against production — no manual dashboard step, no waiting for Ali to run SQL (confirmed by Ali 2026-07-01, after migration 0041).

## Units — diapers are sold in PACKS and CARTONS. Never pieces. (Ali, 2026-08-05)

This is permanent. Ali has had to say it three times.

- **Nobody in this trade sells diapers loose.** The supplier sells packs and
  cartons; Ali sells packs and cartons. Every SKU's `sellable_units` is
  `{pack,carton}`, `{carton}` or `{pack}` — **not one SKU sells `piece`.**
- **Never show a piece count to the user.** Not "192 pcs", not "= 128 pieces
  total", not "64 pcs in stock". Say "1 carton (4 packs of 48)" or "2 packs of
  34". Use `formatQtyInTradeUnits` in `lib/trade-units.ts` — it already exists,
  do not write a second one.
- **Pack SIZE is kept** ("4 packs of 48") because that is how a diaper variant
  is identified — a 48s and a 34s are different products.
- **Pieces stay in the DATABASE**, for four reasons and no others: the stock
  ledger (what lets a part-opened carton exist), landed cost (a carton divides
  to a piece before it meets a price), competitor comparison (rivals sell
  30s/34s/48s, so per-piece is the only comparable unit), and mixed cartons.
- **Money must be measured against the unit actually sold.** Dividing landed
  cost by a per-piece price nobody is charged produced margins wrong on 21 of
  29 SKUs (migration 0139). Margin, promo floors and price suggestions all use
  the pack/carton price.

### SKU code convention — read it, it tells you the pack config
`BRAND-MODEL-SIZE-{pcs_per_pack}x{packs_per_carton}`

`MAMY-XTRA-XXXL-34x3` = **34 pieces in a pack, 3 packs in a carton** (102 per
carton). This holds for every diaper SKU. If a GRN, a batch or a piece count
disagrees with the code, **the code is right and the other number is the bug** —
do not ask Ali to arbitrate what the code already states.

Two SKUs can share a size and still be different products: `XXXL-22x4` and
`XXXL-34x3` are separate retail pack formats. **Never compare their per-piece
economics and read a difference as evidence of anything.**

### Carton dimensions are REAL and load-bearing — but partly estimated today
Ali (2026-08-05): *"Cbm figures are not stand in. I use it to calculate actual
cbm. It is critical for reliable [costing] but I must make sure the
measurements are accurate. I filled most from a single measurement just for
rough calculations."*

So: **CBM is meant to be true**, it drives the freight/local apportionment in
`confirm_grn`, and improving it improves every landed cost. It is currently
approximate because most SKUs were filled from one measurement, not because it
is a placeholder. Treat it as real data with known error, not as junk.

- `skus.cbm_per_carton` is a **GENERATED column** = L × W × H ÷ 1 000 000. Only
  the three dimensions are ever entered. Never write CBM directly.
- 31 SKUs share only **5 distinct carton sizes**, so accuracy is a
  five-measurement job. On SH-2026-001 the sizes carry 47.1 / 19.9 / 18.4 /
  14.3 / 0.4 % of freight — the top three are 85% of it.
- **Do not infer product facts from CBM.** It is accurate enough to split
  freight and not accurate enough to deduce what is inside a carton. A
  confident argument about pack contents was once built on CBM-per-piece and
  was wrong. Freight apportionment, yes; forensics, no.

## Hard Rules (never break)
1. All financial calculations in **Postgres**, never TypeScript
2. Stock quantity derived from `stock_movements` sum — never stored directly
3. Forex rate locked at GRN confirmation — never recalculate after
4. Zero-CBM shipment line → block GRN with clear error
5. SKU hierarchy = 7 levels: Brand → Category → Variant → Packaging → Unit Size → Units/Pack → Packs/Carton
6. Push to GitHub after every confirmed working change
7. Never call Supabase directly in pages — always via `lib/queries/`
8. **A new page is not done until it appears in the menu.** Nav grouping is
   DATA (`section` on each item in `components/layout/nav-config.ts`), read by
   both the mobile More sheet and the desktop sidebar. There was once a second
   hardcoded list of hrefs in each of those files, so adding a page to
   nav-config did nothing — the Price Simulator shipped built, routable and
   invisible. Never reintroduce a local list. After adding a page, open the
   menu and confirm it is there.

## Key paths
- Queries: `lib/queries/` · Pages: `app/(app)/` · Components: `components/`
- Sales status flow: `draft → confirmed → out_for_delivery → delivered`
- `postSale(orderId)` RPC deducts stock FIFO on confirmation
