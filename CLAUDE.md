@skills.md
# SayNoMore — Project Rules

> **Starting a new chat?** The exact prompt to paste is in `docs/NEW_CHAT.md`.
>
> **Continuing in a new chat?** Read `docs/HANDOFF.md` first — project/access
> IDs, the module map, the design system map, and what's built.
>
> **But treat HANDOFF as a MAP, not the record.** The record is
> `app/globals.css` (every design token with its reasoning and date),
> `supabase/migrations/*.sql` (every money/stock rule with a why-header),
> `skills.md`, and `git log`. Those are committed and cannot be lost when a
> chat ends. A summary can only lose the *pointer*. **Read
> `app/globals.css` before touching any UI** — it holds four palettes
> (sunrise/aurora/ember/monochrome, each light+dark), the Liquid Glass frost
> dial, and the Display P3 wide-gamut tuning for Retina/OLED. None of that is
> obvious from a component file, and all of it is easy to break by accident.

## Behaviour
- Plain English. One recommendation. Lead with the answer.
- Never ask Ali to choose between technical options.
- **Always research current expert/industry best practice before building, and
  apply it** — how professionals actually solve this problem (UI/UX patterns,
  data modelling, finance/inventory conventions), to current standards. Never
  hand-wave, guess, or skimp on details. Build it properly the first time and
  say briefly what standard you applied.
- **Run every proposal through the expert council BEFORE presenting it to
  Ali, not just before building it.** Ali, 2026-08-06: *"I told you I'm a
  layman without any knowledge. That's why from now on before you agree to me
  you must always use expert knowledge in all relevant fields."* The incident:
  a competitor-price feature was proposed that would let any tracked
  product's rival price be compared against any other — a diaper trial could
  have been benchmarked against a soft drink. Ali caught it; an ERP/FMCG lens
  (skills.md Seat 5) would have caught it first, since category-scoped
  competitive benchmarking is baseline retail-buying practice. He cannot
  catch a cross-domain flaw himself — that is what he is asking me to do
  before it reaches him. Concretely, before proposing a plan, screen or
  calculation: check it against ERP/backend correctness (Seat 3), FMCG
  operations conventions (Seat 5), finance/accounting conventions (Seat 4),
  UI/UX (Seat 1), and frontend/backend engineering soundness (Seat 2) —
  whichever seats are relevant — and only then bring him ONE recommendation.
  The four-line pre-build checklist is necessary but not sufficient; it names
  fields and screens, not whether the underlying logic makes domain sense.

## Before building ANY screen — the gate that keeps being skipped

Every complaint Ali has raised about a new screen traces to the same cause: I
built from my own idea of the job instead of from the screen in this app that
already does it. Migration 0141's header says so in as many words. It happened
again on the costing simulator's new-product sheet.

**So: no UI is written until this list is written out first, in the reply, and
Ali can see it.** It is four lines, it costs nothing, and he can spot a wrong
one in ten seconds — which is the point, because a written field list is the
only design artifact he can review on a phone.

1. **Which existing screen does this same job?** Name the file and the
   component. If a screen in this app already takes these inputs, the new one
   copies it — fields, order, labels, units, and chrome. A second pattern for
   the same job is a tax on him.
2. **Every field, with its UNIT spelled out.** "Supplier price" is not a field.
   "Supplier price — of ONE carton, or ONE pack, chosen by a pill, echoed back
   as `= X per carton`" is a field. Any figure whose unit a reader could guess
   wrong is a defect, not a detail.
3. **Where does each unit WORD come from?** `sellable_units` and the unit noun
   — never a hardcoded "pack". A product sold only by the carton must never be
   asked for a pack price, and a bottle is never a "pack".
4. **Which existing components and classes?** `.label-caps`, `.snm-input` /
   `h-12 rounded-xl px-4 ios-subhead`, `--glass-bg-1` inputs on a `--glass-2`
   sheet, pill toggles with the `Check` icon, fixed header + one scrolling body
   + pinned footer. **Never invent a new input primitive.** If a new one seems
   needed, that is the signal to go back to step 1.

**Contrast is not a matter of taste — and the usual failure is TEXT, not
surfaces.** `--muted-foreground` is `#8e9192`. A bottom sheet is `--glass-2` —
13% white over the page gradient. That pairing measures about **2.6:1**, under
the 4.5:1 readable floor. Other screens survive it because their muted text is
one short caption *beside* real `--foreground` content; a form that is mostly
empty has no such content, so if the captions, the field names (as
placeholders), the helper lines and the unselected pills are all muted, the
whole screen is one grey wash. That is precisely what shipped on the costing
simulator's new-product sheet.

- **If it has to be read, it is `--foreground`** — optionally at `opacity: 0.7–0.85`
  for hierarchy. Reserve `--muted-foreground` for text that genuinely does not
  matter, and on a `--glass-2` sheet, prefer not to use it at all.
- **A field's NAME never lives in its placeholder.** Placeholders are muted by
  definition, so on an empty form the name disappears. Label above (like
  Products → Edit SKU); placeholder carries the FORMAT only (`48`, not
  "Pieces per pack").
- **An unselected pill that carries a CHOICE is content, not a hint** — real
  `--foreground` text on `--glass-bg-1`, never muted-on-transparent.
- **Prose is a contrast problem too.** One short line per field. Four
  multi-line grey paragraphs read as an illegible block no matter the token.

Surfaces still step: page → `--glass-2` sheet → `--glass-bg-1` field. Never
place a surface on itself.

**Derived numbers are never typed.** CBM is `L × W × H ÷ 1 000 000` — a
generated column in the database, entered as three dimensions in Products and
echoed back. Ask for the same three anywhere else and echo the same way. If the
app computes a number in one place, asking the user for it in another is a bug.

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
  do not write a second one. Postgres has the twin: `qty_in_trade_units` /
  `unit_noun` (migration 0143), used by `sales_order_item_summary` and
  `get_sales_order_delete_impact`.
- **"The user" means EVERY word Ali reads — not just app screens.** Ali,
  2026-08-06: *"I never sell diapers by pieces. It's always sold in packs and
  cartons. Nobody will sell diapers in pieces."* He had to say it a fourth
  time, because the rule as written read like a UI rule and I was writing
  prose. A whole business audit was delivered to him in pieces — "630 pcs
  sold", "2,200 pieces of demand", "7.3 diapers/day" — every headline number
  in a unit he does not trade in, so he could not sanity-check a single one
  against his own knowledge of his business. **The unit rule applies
  identically to: chat replies, analysis, audits, recommendations, commit
  messages he may read, PR descriptions, and anything pasted into a message.**
  Pieces are legitimate in SQL and in the database — they are the ledger's
  unit. They are NOT legitimate the moment a number crosses into something
  Ali reads. **Convert at the boundary, every time: divide by `pcs_per_pack`
  for packs, by `pcs_per_pack * packs_per_carton` for cartons, and say which.**
  If a rate must be expressed per-day, say "about 2 packs a week", never
  "7.3 pieces a day".
- **Never offer a selling unit the SKU doesn't sell.** `skus.sellable_units` is
  the only input — `sellableTiers()` in `lib/trade-units.ts`. Screens used to
  *synthesise* a third "Piece" button for any pack-selling SKU, so every diaper
  invited a loose-piece sale; the add-item and returns sheets went further and
  hardcoded all three tiers, so a carton-only Sosoft could be sold by the pack
  in one place and not the other. Checked against every line ever sold: all 51
  `uom='piece'` lines are Sosoft bottles in a mixed carton, never a diaper.
  Same guard, every door.
- **Money is quoted in the unit sold, too.** Landed cost lives per piece in the
  DB; on screen it is per pack or per carton (`costPerTradeUnit`). Shipment
  lines lead with the carton. Price Lists takes a pack price and a carton price
  and *derives* the per-piece column — Ali is never asked to price a loose
  diaper.
- **One exception, deliberate: Market (competitors).** Rivals sell 30s/34s/48s,
  so per-piece is the only comparable unit. Per-piece figures there are correct
  and must stay. Stock Ops keeps a loose tier as well, because a write-off or a
  count adjustment is a *ledger* event (a torn pack is real) — but it is named
  after the product ("btl"), never blanket "pcs".
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
9. **Never `git reset --hard` toward a branch without diffing what's on each
   side first.** Ali, 2026-08-06: *"I told you to make absolutely sure you
   apply what experts will do."* The incident: reconciling this session's
   branch against `origin/main` after a squash-merge, `reset --hard` was run
   on the assumption `origin/main` already had everything — it didn't, and a
   real commit (Supabase CLI test tooling, a migration fix) was silently
   discarded and had to be redone. A safe, non-destructive reconciliation
   method was already known and had worked once (`git stash` → `reset --hard
   origin/main` → `stash pop`, resolving conflicts by keeping the stashed
   side, then a normal `push` with no force) — and was abandoned twice more
   afterward for `git push --force` out of expediency, which is the deeper
   failure: knowing the disciplined method and not using it every time.
   **Going forward: fetch and diff before any reset; use the stash-and-pop
   method to reconcile a diverged branch; treat `--force`/`--force-with-lease`
   as a last resort requiring the same care as any other destructive command,
   never a shortcut.** Extends the same standard to security review: a fix
   for one instance of a bug class (e.g. an anon-grant gap) is not done until
   the whole surface it touches has been swept systematically, not left to
   be discovered one test run at a time.

## Key paths
- Queries: `lib/queries/` · Pages: `app/(app)/` · Components: `components/`
- Sales status flow: `draft → confirmed → out_for_delivery → delivered`
- `postSale(orderId)` RPC deducts stock FIFO on confirmation
