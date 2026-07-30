# SayNoMore — Session Handoff / Continuity

**Read this first when continuing in a new chat.** It captures the project,
access, design system, what's been built, and the open task list so nothing is
lost between sessions. Pair it with `CLAUDE.md` and `skills.md` (the standing
laws), which load automatically.

---

## 1. Project & access

- **Owner:** Ali — non-technical, runs the business from an installed **iOS PWA**.
- **Business:** SayNoMore — FMCG import & distribution, Maldives (rufiyaa / MVR).
- **Repo:** `kudanulafaa-zahab/saynomore` (public). Develop and deploy on **`main`** →
  commit + push to `main` triggers a **Vercel production deploy**. No feature branches.
- **Supabase:** project id / ref `smhdwkrmiytvpsgqezsl` (org `yzyphsswhzbdhjbwqxlq`,
  region ap-southeast-1, Postgres 17). Migrations in `supabase/migrations/`, applied
  live via the Supabase MCP in the same work unit. **Latest applied: 0118.**
- **Vercel:** team `team_qyYXhgTXNYb5dCxNgfIMmQxk` ("kudanulafaa-zahab's projects").
  **Two projects on it now:**
  - `saynomore` (staff app), id `prj_rlOeqBEzmdNbbQMagyCC2nsuecGk`. Prod aliases:
    `saynomore-beta.vercel.app`, `saynomore-kudanulafaa-zahabs-projects.vercel.app`.
    Git-linked — pushes to `main` auto-deploy.
  - `saynomore-shop` (customer storefront, new this session), id
    `prj_oB9tek3qFUxK4qHJFopQhjIMY6aG`. Live at **saynomore-shop.vercel.app**.
    **NOT git-linked** (this session's tools can only file-upload deploy, not create
    a git-linked project with a custom root directory) — pushes to `shop/**` do
    **not** auto-deploy; see `docs/STOREFRONT_PLAN.md` → "Deployed" for how to
    redeploy or fix this properly. No domain purchased yet (Ali: hold off;
    `saynomoreshop.com` is available for $11.25/yr when he's ready).

**Access carries over automatically — no passwords are stored here (public repo).**
GitHub, Supabase and Vercel are reached through the session's MCP connectors, which
reconnect on their own in a new chat under the same account — a new session gets the
exact same tool access this one had, nothing to re-authenticate. Real secrets
(service-role keys, DB passwords) live in the Vercel/Supabase project settings and
were never used or stored by this session. The **public** anon/publishable Supabase
keys (safe to expose client-side, gated by RLS — not secrets) are already baked into
`shop/next.config.ts`'s `env` block as a fallback default (no `.env` file is
committed anywhere in this repo, matching the main app's own convention — Vercel
project env vars are the normal source, `next.config.ts`'s fallback exists only
because this session's tools can't set Vercel project env vars via API). Project
URL: `https://smhdwkrmiytvpsgqezsl.supabase.co`.

---

## 2. Stack (locked)

Next.js 16 App Router + Turbopack · React 19 (**React Compiler ON** — no manual
`memo`/`useMemo` for perf) · TypeScript strict · Tailwind v4 · shadcn/ui · Supabase ·
Vercel · Lucide icons.

Key paths: queries `lib/queries/` · pages `app/(app)/` · components `components/` ·
migrations `supabase/migrations/` · design tokens `app/globals.css`.

---

## 3. Design system — light **and** dark, themed and deliberate

**This is NOT "just monochrome."** It is a full **light/dark adaptive glass** system,
already built and refined over many sessions, and it must be preserved.

- **Adaptive theming:** every colour is a CSS variable in `app/globals.css`
  (`--foreground`, `--background`, `--glass-*`, `--muted-foreground`, semantic tokens).
  Both themes are hand-tuned; the viewer's toggle stamps the theme. **Never hardcode hex.**
- **Glassmorphism:** translucent glass surfaces, a fixed atmospheric page gradient,
  specular sheen, hairline inner borders, a user "frost dial", ambient background motion.
- **Monochrome ACCENT (not monochrome app):** the *accent* is graphite (foreground),
  no decorative hue — because on a money app, **green/red/orange are reserved to mean
  money** (good / loss / attention). Interactive emphasis comes from weight, not hue.
- **iOS-native feel:** Apple HIG type scale (`ios-*`), tabular money (`.snm-num`),
  44pt targets, safe-area insets on fixed/floating chrome, spring sheets, rubber-band
  bounce ON, `prefers-reduced-motion` respected.
- **Management-by-exception (pricing):** healthy state is quiet/colourless; only
  problems (loss=red, thin=amber) carry colour — so risk can't hide in a "sea of green".

---

## 4. Hard rules (never break)

1. All money & stock math in **Postgres** (RPCs/views) — never TypeScript. UI renders numbers.
2. Stock = SUM(`stock_movements`). Forex locked at GRN. Immutable once posted; corrections
   are reversing entries; `audit_log` on money/stock mutations.
3. Every SECURITY DEFINER fn: `SET search_path`, `(select auth.uid())`, **REVOKE from anon**.
4. Never call Supabase directly in pages — always via `lib/queries/`.
5. Commit to `main` → push → Vercel prod deploy; verify READY. Supabase changes live via MCP.
6. **Mobile overlays must portal above the chrome.** The app shell wraps pages in
   `relative z-[1]`, which traps inline `fixed` overlays under the z-40 topbar/tab bar.
   Wrap any bottom sheet/full-screen overlay in **`<BodyPortal>`** (`components/ui/body-portal.tsx`)
   or use the shared `Sheet`/base-ui `Dialog` (both already portal). This bit us repeatedly.
7. Verify every change: `npx tsc --noEmit` + `npm run build`. Say plainly when a
   live/mobile fix couldn't be device-verified (the test rig's egress to Supabase is
   blocked by policy this environment).

---

## 5. Customer storefront (`shop/`) — built and LIVE this session

**No longer "on hold."** Ali greenlit it, backend + UI are built and deployed to
production: **https://saynomore-shop.vercel.app**. Full detail, migration-by-migration,
and the exact in-flight requirements to pick up next all live in
**`docs/STOREFRONT_PLAN.md`** — read it before touching anything storefront-related,
it's more current and more detailed than this file for that one topic. The short version:

- Separate Next.js app at `shop/` (own `package.json`/config, sibling to the root app
  in the same repo — NOT a workspace). Guest checkout, no accounts, no staff auth.
  Every read goes through `get_storefront_catalogue()`, the only write is
  `place_customer_order()` — both SECURITY DEFINER, anon-granted, both documented at
  length in migrations `0115`/`0116` including why they're functions and not views.
- Migrations `0112`–`0118` cover: `order_source`/`web` channel, the web-fulfilment
  godown flag, `variants.image_url` + a public `product-images` storage bucket, the
  catalogue read, the order-placement write, `order_source` surfaced in Sales/Dispatch
  (a gray "Web" badge), and `product_categories.storefront_visible` (Tobacco is
  excluded from the guest shop by default — a real gap caught and closed, not
  hypothetical).
- Root `tsconfig.json`/`eslint.config.mjs` explicitly **exclude `shop/`** — this was a
  real production outage caught and fixed live: the first push broke the STAFF app's
  Vercel build because its TypeScript pass started resolving `shop/`'s files against
  the wrong `@/*` alias. Don't remove that exclusion.
- **Not built yet, real requirements Ali gave, nothing coded**: curated brand/model
  hierarchy with display-only renames, a general "seasonal product" mechanism, a
  mixed-carton-of-6 guest checkout flow (needs a real `place_customer_order` change,
  scoped in the plan doc), The Body Shop seasonal lotion listing (blocked on real
  facts from Ali — scent names, price, stock, photos), and a full set of drafted
  homepage/brand copy not yet placed on any page. **All of this is written up in
  detail in `docs/STOREFRONT_PLAN.md`'s final two sections — start there.**

---

## 6. Built this session (recent → older highlights)

- **0100 FK indexes + screen error boundaries.** Eleven foreign keys had no index, so a
  parent delete sequential-scanned `audit_log`, `sales_orders`, `order_payments`,
  `shipments`, `stock_movements`. And the app had **zero** error boundaries: any render
  error unmounted the tree, which on the installed PWA is a blank page with no browser
  chrome to reload from. Added `app/(app)/error.tsx` (tab bar survives, one Try again) and
  `app/global-error.tsx` (self-contained, for root-layout failures).

- **0101 Sales list is server-paged.** `listOrders()` downloaded EVERY order with every line
  joined, then rendered 20 — the render was capped, the download was not (~890 bytes/order,
  so ~4.4 MB at 5,000 orders, on every open). Now **keyset pagination**: `get_sales_orders`
  takes a `(created_at, id)` cursor and seeks straight to it, so page 500 costs the same as
  page 1 — OFFSET would walk and discard 500 rows first. The `id` is in the cursor because
  timestamps aren't unique; without it rows at a page boundary duplicate or vanish.
  **Verified by paging the whole table in 7s: 8 pages, 53 rows, 0 duplicates, 0 missing.**
  Status/search/unpaid filtering moved into Postgres (with one page in memory, filtering the
  client array would only search what's downloaded), the order total is now summed in
  Postgres (hard rule #1 — it was a TypeScript `.reduce()`), and the Customers grouping is
  rolled up by `get_sales_order_customers` for the same reason. Infinite scroll via an
  IntersectionObserver sentinel (400px rootMargin) with a Load-more button as the fallback.
  **These three are SECURITY INVOKER on purpose** — `sales_orders` RLS gives a staff driver
  only their own runs, and a DEFINER function would hand them everything.
  `peek_next_order_number()` (DEFINER, since `order_number_counters` has RLS with no
  policies) replaces the client-side guess in the New Sale dialog.

- **0099 customer insights** (`get_customer_insights` / `_products` / `_orders`): answers "who
  are my top customers and what did they buy?", which had no answer anywhere before —
  `/customers` was a contact list and Sales → Customers only groups on-screen orders. Built on
  **RFM** but ranked by **PROFIT, not revenue** (margins run 24–43% by SKU, so equal spend ≠
  equal worth), **net of returns**, plus **% share of all sales** (concentration risk),
  **at-risk** (the 0078 rhythm signal, previously buried in the morning briefing) and
  outstanding balance. `/customers` gained lenses (A–Z · Top customers · At risk · Owes) and a
  value line per row; **new `/customers/[id]`** shows profit/orders/avg/rhythm, then full
  **order history** (tap → the order) and **what they buy** grouped by product in ctn/pk.
  _Note: at_risk deliberately needs 3+ distinct order DAYS — one gap is not a rhythm._
  Follow-up fix: the A–Z cards were `<div cursor-pointer>` with no link, so the detail was
  unreachable from the directory — now a Link scoped to the avatar/name so Edit/Delete still work.
- **Toolchain to latest (verified, with reasons where "latest" was wrong):** Next 16.2.12 ·
  React 19.2.8 · Tailwind 4.3.3 · Supabase JS 2.110.8 / SSR 0.12.3 · TypeScript **6.0.3**
  (7.x installs but `next build` rejects it — "does not provide the compiler API required by
  Next.js"; needs an experimental flag, not worth it here) · ESLint stays **9.39.5** (10 CRASHES
  eslint-config-next's bundled eslint-plugin-react) · `@types/node` **22** not 26 (must match the
  Node 22 runtime or code type-checks against APIs that don't exist at runtime) ·
  `@zxing/library` 0.23.0 (newer than its stale "latest" tag). **Do not run `npm audit fix
  --force`** — every remedy it proposes is a DOWNGRADE (next→9.3.3, eslint-config-next→0.2.4).
- **middleware.ts → proxy.ts** (Next 16 convention; deprecation warning gone, route still
  registers as Proxy so it IS wired). Auth logic untouched.
- **Lint: 0 errors** (was 59). Real fixes: `useMounted()` via `useSyncExternalStore` (BodyPortal,
  Sheet, mobile SKU sheet), `Date.now()` → pure counter for cart-line keys, unused bindings, and
  documented `<img>` exceptions in the PRINT label templates. The remaining 55 are one advisory
  rule (`react-hooks/set-state-in-effect`) on the deliberate loader/form-sync patterns — set to
  **warn** with the full rationale in `eslint.config.mjs`. Verified empirically that skills.md's
  own loader convention does NOT clear it (the rule traces into any called function), so
  clearing it would mean restructuring every money screen untested. Don't blind-refactor.
- **Sales list: day headings** (Today / Yesterday / date). The sort was always correct —
  newest-first by order date, status is a badge not a sort key — but with no date on the rows it
  looked random. Headings make the sort visible; nothing about the sort changed.
- **Reorder rebuilt as ONE grouped list** — the urgent SKUs used to appear in a "Suggested
  orders" card AND again in the browse list (same row twice). Now: grouped by product, urgency
  highlighted in place (coloured edge + status + order-by date), a lens ("Needs ordering · N" /
  "All products") that FILTERS rather than duplicating, search + stock sort. Plus **any product
  can be added to a PO** (container freight is per CBM — you consolidate, not just replenish),
  and the bar now opens a **review sheet** (lines, cartons, CBM, ≈% of a 20ft/40HQ) instead of
  creating the PO on tap. Deliberately a review, not an "Are you sure?" — draft POs are
  reversible and nag-confirms cause fatigue.
- **Dialogs (shared component):** one scrolling card — title at the top of the content, Save/
  Cancel at the END (scroll down to reach), no sticky/floating chrome, actions side-by-side.
  Also fixed the SKU-edit freeze (detail sheet stayed open under the edit dialog; two
  scroll-locks jammed the page after save).
- **0098 customer returns** (`record_customer_return`, `get_returns`, new `sales_returns`):
  the last "designed but not built" gap. **"Record a return"** on a delivered order — product,
  qty in ctn/pk/pcs (shows the value at the price they paid), reason, a **per-return settlement
  choice** ("Less to pay" = credit, "Money back" = refund), and a "good to sell again" toggle.
  Reverses the sale as reversing entries the existing engines already read, so they can't drift:
  stock `return_in` back to the **original batch at the original landed cost**; `get_pnl` gains a
  **returns_net_mvr** line (refund − cost recovered = true margin lost); `get_receivables_aging`
  nets off returns (dashboard follows via 0080); a refund also writes a **negative
  `order_payments`** row (`is_reversal`). Over-returning blocked; credit refused with a clear
  message when nothing is owed. **Verified live in rolled-back transactions:** refund → stock
  0→44, returns line 56.34, net profit −56.33, owed unchanged; credit → owed 220→0. ✓
- **0096/0097 write-off traceability:** the P&L "Damaged & write-offs" figure now **explains
  itself in place** — indented sub-lines beneath it (product · qty · reason · MVR), the same
  pattern as the Operating Expenses categories. `get_recent_writeoffs(from,to,limit)` is
  period-scoped so the sub-lines always total the line exactly (verified 93.66 = 93.66). A
  "Recent write-offs" log also sits at the top of Stock Ops → Write-off.
  **Lesson recorded:** don't navigate away to explain a number; explain it where it's read.
- **0095 what-sells on the reorder screen:** `sold_90d` (real units sold, 90d) surfaced with a
  catalogue-relative **Top seller / Steady / Slow mover** tag, shown in **cartons/packs — never
  loose pieces** (diapers sell by pack/carton). Decision support at the point of decision, no
  new screen.
- **0094 audit_log allows `write_off`:** write-offs were failing on
  `audit_log_action_check` (only insert/update/delete allowed) → the audit insert failed and the
  whole write-off rolled back, so the sheet hung on an error. Constraint widened.
- **Dialog structure (shared `components/ui/dialog.tsx`):** the sheet is ONE scrolling card —
  the title is plain content at the top and the Save/Cancel sit at the END of the content
  (scroll down to reach them). **No sticky/floating chrome** — a pinned header + translucent
  (`bg-muted/50`) sticky footer let form text run above, behind and through the action bar.
  Actions are side-by-side (Cancel | Save), not stacked. Affects every dialog.
- **SKU edit freeze fixed:** on mobile, "Edit SKU" opened the edit dialog *without* closing the
  detail sheet, so the sheet (z-60, own scroll-lock) sat on top of the frozen form and the two
  scroll-locks jammed the page after save. One overlay at a time now.
- **0093 stock write-off** (`write_off_stock` + `get_pnl`): the proper ERP handling for
  damaged/expired/lost stock — Stock Ops → **Write-off** tab (reason-coded, FIFO, admin/manager,
  confirm, returns the MVR loss). Removes stock via `damage_out` movements valued at each batch's
  locked landed cost, audit-logged. `get_pnl` gained a **stock_writeoff_mvr** line and subtracts
  it from net, shown as "Damaged & write-offs" in Financials — so damage is recognised as a loss
  instead of silently overstating profit. (Schema already had `damage_out`/`damage`; nothing used
  it and the P&L ignored it.)
- **0092 Price Book last-known cost** + inventory case/pack display + money-first Price Book +
  reorder pcs/pack + inventory quantity sort (grouped by product): see git log for the batch of
  screenshot-driven fixes.
- **0091 campaign confounder flags** (`get_campaign_roi`): a boost verdict now carries a
  neutral "Read with caution" caveat when its window overlapped a **stockout** (an attached
  SKU's running on-hand hit ≤0 — demand throttled by supply) or a **price change** (avg unit
  price shifted ≥8% vs baseline). Verdict unchanged; we flag, don't rewrite. Caveat is neutral
  (a measurement note, not money).
- **0090 trend-aware reorder velocity** (`get_sku_reorder_alerts` + `get_reorder_suggestions`):
  forward velocity = recent 30-day rate + an upward-only, capped (+40%) buffer when demand is
  accelerating above the SKU's own fair baseline (units ÷ actual selling days, ≤90). Steady/
  falling keep the recent rate, so orders never regress below the old engine. A neutral
  "▲ picking up / ▼ slowing" chip rides through to the reorder list. Calendar seasonality is
  deliberately deferred (needs multi-year history; would mislead now).
- **Price Book UX polish:** tappable stat-tile filters (loss/thin/healthy), in-page search +
  sort (A–Z / worst / best margin), clearer secondary labels ("+MVR X profit / carton"). Kept
  quiet-healthy (no green badge) and the desktop table.
- **0089 cash-flow / runway forecast** (`get_cash_forecast` + `_meta`, `set_cash_balance`,
  new `cash_snapshots` table): Financials → **Cash Flow** tab. Answers "will I have cash for
  the next shipment?" — a 13-week running-balance timeline (sales run-rate + outstanding
  receivables IN; operating run-rate + open-shipment payables OUT), anchored on a user-entered
  **cash-on-hand** snapshot (append-only, audit-logged). Every assumption is a returned number
  shown in the UI so the forecast is honest; open shipments with no arrival date are surfaced
  as an off-timeline warning. All math in Postgres; anon revoked; advisor clean.
- **Editable expense date:** Expenses Quick Log now has a date field (default today, capped at
  today) so a cost can be back-dated/corrected — feeds the correct P&L month. UI-only; the
  query layer already accepted `expense_date`.
- **0088 campaign verdict** (`get_campaign_roi`): boosts now JUDGED — profit lift
  (contribution vs snapshot COGS), net of spend, 3-window smoothed baseline, units +
  new customers, verdict (worked/marginal/no_effect/insufficient). Card shows it in
  plain money. (Marketing was the weakest intelligence; now it decides.)
- **Price Book** (Market → new tab) on **0087 `get_price_book`**: per-SKU landed cost,
  price, profit, live margin, flag — all in Postgres. UI is a **platform-adaptive margin
  ledger**: prioritized **list on mobile**, full **table on desktop (`lg:`)**, exception-first
  ("Needs attention" default), quiet-healthy. Rebuilt from a rejected giant-card version.
- **App-wide overlay portaling:** `BodyPortal` created; Dispatch confirm, shared
  `ConfirmSheet`, barcode scanner, price-list editors, product/expenses/shipment/
  sale-detail/my-deliveries sheets all lifted above the tab bar.
- **0086 atomic order numbers:** duplicate-key bug fixed — per-year counter + BEFORE
  INSERT trigger (was client-computed max+1, collided on stale cache / concurrent users).
- **0085 keepalive:** GitHub Action pings a heartbeat RPC Mon+Thu so the free Supabase
  project never pauses.
- Market → Competitors sorted by catalogue order (was gap%, scattered sizes).
- Sosoft carton mixer leads with colour; Customers single-letter avatars + A–Z rail;
  swr-lite persistent cache + router cache; out-of-stock visibility (0084); inventory/
  godowns redesign; reorder floating action bar; unpaid tile deep-link fix.

---

## 7. Open / next tasks (priority order)

_Done this session: editable expense date, cash-flow/runway forecast (0089), trend-aware
reorder velocity (0090), campaign confounder flags (0091), Price Book UX polish + last-known
cost (0092), stock write-off (0093/0094), what-sells on reorder (0095), write-off
traceability (0096/0097), customer returns (0098), plus the dialog/SKU-edit fixes above._

_Notes carried forward: the cash forecast's inflow model has a known, labelled minor overlap
(ongoing sales run-rate + current receivables both counted) — transparent, not hidden;
supplier payments timed to expected arrival (a visible assumption). The reorder trend is
upward-only (never orders less than before); true calendar seasonality is deferred until
there's multi-year history. Returns/write-offs show as their own P&L deduction lines
(Gross Sales − deductions), so gross revenue elsewhere (Reports, charts, dashboard) is
intentionally GROSS — the deductions are itemised on the P&L rather than silently shrinking
revenue._

### Still designed-but-unused in the schema (audited 2026-07-27, nothing broken)
Available whenever Ali wants them, no work needed to "unlock" — they're just unused:
**wholesale/VIP price tiers** (full price-list system is wired into order pricing; 0 price
lists exist, so every sale uses the standard price) · **expiry/FEFO alerts** (capture at GRN +
≤120d view + ≤60d briefing all built; 0 expiry dates entered, so it's dark) · **card
payments** (allowed; waiting on the storefront/BML phase) · **per-100ml/100g competitor
pricing** (detergent categories are set up for it; no rival prices logged that way) ·
**extra supplier currencies** (MYR/THB/CNY/EUR).

1. **Customer storefront** — greenlit, built, and LIVE (see section 5 above). The
   5 original product decisions are all resolved. What's left is a fresh batch of
   real requirements from Ali (hierarchy curation, seasonal products, mixed-carton
   guest checkout, The Body Shop listing, homepage copy) — none of it coded yet.
   Full detail and exact next steps are in `docs/STOREFRONT_PLAN.md`'s final two
   sections ("Deployed" and "Next session: in-flight requirements, none built yet").
   Start there, not from scratch.

---

## 8. Working with Ali

Plain English, lead with the answer, ONE recommendation, money-first (rufiyaa before %).
Use genuine expert judgement — do NOT just agree; push back with reasons when warranted;
research to current standards, don't hand-wave. His screenshots are the QA channel. Never
claim a mobile fix works without verifying, and say plainly when device verification wasn't
possible and what would unlock it.
