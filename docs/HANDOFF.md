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
  live via the Supabase MCP in the same work unit. **Latest applied: 0130** (the
  full money-math audit — see sections 5b, 5c and 5d).
- **Vercel:** team `team_qyYXhgTXNYb5dCxNgfIMmQxk` ("kudanulafaa-zahab's projects").
  - `saynomore` (staff app), id `prj_rlOeqBEzmdNbbQMagyCC2nsuecGk`. Prod aliases:
    `saynomore-beta.vercel.app`, `saynomore-kudanulafaa-zahabs-projects.vercel.app`.
    Git-linked — pushes to `main` auto-deploy.
  - A second, leftover Vercel project from the removed web shop. It is **not**
    git-linked, serves a blank placeholder, and has nothing to do with the
    staff app. **Ali should delete it:** vercel.com → that project → Settings →
    Delete Project. Take care to pick the leftover one, NOT `saynomore`, which
    is the live staff app. There is no delete-project capability in this
    session's tooling — the project was created as a side effect of the deploy
    tool, which has no inverse.

**Access carries over automatically — no passwords are stored here (public repo).**
GitHub, Supabase and Vercel are reached through the session's MCP connectors, which
reconnect on their own in a new chat under the same account — a new session gets the
exact same tool access this one had, nothing to re-authenticate. Real secrets
(service-role keys, DB passwords) live in the Vercel/Supabase project settings and
were never used or stored by this session (no `.env` file is committed anywhere in
this repo). Project URL: `https://smhdwkrmiytvpsgqezsl.supabase.co`.

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

## 5. Customer storefront — removed, do not resurrect

A customer web shop was built, Ali reviewed it, and asked for it to be
removed completely. Every trace is gone: the code, the database objects, the
planning docs, and the migrations that created them. **Verified 2026-08-04:**
zero related functions, tables, columns or data anywhere; zero references in
`lib/`, `components/` or `app/`.

If a storefront is ever wanted again it starts as a brand-new design — there
is deliberately nothing left to resume from, and nothing here should be
treated as a starting point.

One leftover Ali needs to action himself: the old Vercel project shell (see
section 1). It serves a blank placeholder, not a shop.

Two things were kept on purpose, and are **not** storefront features:
`variants.image_url` + the `product-images` bucket + the Edit Variant photo
upload (a staff Products feature holding 7 real photos — deleting it would
destroy real data and break a working screen), and
`sales_orders.order_source`, a column that predates all of that work and is
now constrained to `'walk-in'`.

---

## 5b. Full money-math audit (2026-08-04) — migrations 0121-0126

Ali caught the dashboard and Sales screen disagreeing on "unpaid orders" and,
having lost trust, asked for a full, no-stone-unturned audit of every money/
stock calculation in the app. Three background agents covered financial
reporting, pricing/margin, and inventory/GRN; the order-lifecycle/payments
area and a cross-cutting bypass sweep were done directly. Every finding below
was verified against live data before being trusted, and every fix was
verified again after applying it. Full detail is in the migration file
headers (0121-0126) — this is the summary.

**The headline bug, found while chasing a smaller one down:** Sale Detail's
`isConfirmed` flag (`components/sales/sale-detail.tsx`) used to lump
`status='draft'` in with `'confirmed'`/`'picked'`, so a draft order — one
whose `post_sale()` call never completed (a real gap: the New Sale flow's
`postSale()` runs *after* the order+lines already exist, inside the same
`withOfflineFallback`, so a network error in that narrow window leaves a
real order stuck in draft with no stock deducted) — showed the exact same
"ready to dispatch" screen as a real confirmed order. SO-2026-076 (MVR 220,
delivered 2026-08-03) was walked all the way to delivered this way: real
revenue recognized, zero stock ever deducted, zero cost ever recorded.
Fixed: `isConfirmed` no longer includes draft; a proper "Not confirmed yet
— Confirm Sale" action (calls `postSale()`) was added for the true-draft
state, which previously had no way to complete itself, only delete. The
broken order itself was retroactively corrected (migration 0122 — FIFO
stock deducted, cost/margin snapshotted, exactly what `post_sale()` would
have done, audit-logged as a correction). The upstream network-race gap in
`withOfflineFallback`/`handleSubmit` is **not** closed — flagged, not fixed
— but is now safely contained: a stuck draft is visible and fixable instead
of silently reachable as if confirmed.

**Other confirmed, fixed issues:**
- Every date-bucketed reporting function (`get_pnl`, `get_reports_data`,
  `get_contribution_margin`, `get_abc_analysis`, `get_daily_revenue`,
  `get_monthly_revenue`, `get_dashboard_metrics`, `get_campaign_roi`,
  `get_customer_insights`) bucketed by the database session's UTC instead of
  Maldives local time — a sale placed 19:00-23:59 UTC (00:00-04:59 Malé)
  landed under the wrong calendar day, and near month-end the wrong month.
  All now use `AT TIME ZONE 'Indian/Maldives'` consistently (migrations
  0123, 0126).
- `get_dashboard_metrics` and `get_pnl` disagreed on gross profit (different
  COGS sourcing) — resolved once SO-2026-076 was corrected (the gap turned
  out to be entirely that one order); the `GREATEST(...,0)` floor that hid
  real losses on the dashboard was also removed.
- Returns weren't netted into "how much is still owed on this order" in
  `v_order_balances` (Sale Detail's Outstanding + Record Payment sheet),
  `record_order_payment`'s overpayment guard, `sync_order_payment_status`
  (paid/partial/pending), and `get_customer_orders` (Customer detail's
  "unpaid" flag) — only `get_receivables_aging` had it right. Latent (zero
  credit-settlement returns exist yet) but would show a wrong balance and
  let staff overpay the moment that return type is used. All four now use
  the same `total - paid - returned` formula (migration 0124; helper
  `recalculate_order_payment_status()` also invoked from
  `record_customer_return` for the credit path, which nothing previously
  re-synced).
- `get_tier_price_for_sku` ignored per-UOM fixed prices, silently
  under/overcharging on the Competitor Price Gaps screen only (not real
  sales) — now delegates to the already-correct `get_tier_prices_for_skus`.
- `admin_force_void_grn` deleted `sales_orders` (cascading to
  `order_payments`) for any order that used the voided GRN's stock, with no
  payment check — a real "corrections must be reversing entries" violation.
  Called 3 times historically (2026-07-03/05/08); whether real payments were
  destroyed can't be reconstructed (the function never logged what it
  deleted). Now blocks if any affected order has a payment recorded.
- A stale RLS policy from the original schema (predating `post_sale()`)
  let a `staff`-role session insert raw stock movements directly, bypassing
  FIFO/audit entirely. Unused by any current code path — dropped.
- `v_batch_stock`/`v_stock_levels` reimplemented `stock_signed_delta`'s sign
  logic inline instead of calling it — today they agreed, but it's the same
  "two definitions can drift" pattern — collapsed to call the one function.
- Self-caught regression: the `v_batch_stock`/`v_stock_levels`/
  `v_order_balances` fix above used a bare `CREATE OR REPLACE VIEW`, which
  silently dropped their `security_invoker=true` setting (from migrations
  0053 and 0058). Caught by re-running the security advisor immediately
  after and fixed same-session (migration 0125) — worth remembering:
  `CREATE OR REPLACE VIEW` does not preserve `reloptions` unless restated.

**Verified clean after real scrutiny** (not padding — actually checked):
margin formula convention, division-by-zero guards, the "never
auto-overwrite a fixed price" rule, `block_grn_rate_changes`/
`block_batch_cost_changes`, landed-cost-lock immutability, `confirm_grn`'s
zero-CBM block, `post_sale`'s FIFO correctness and double-post guard,
`void_sales_order`'s payment guards, `stock_signed_delta`
coverage of every movement type, every function's anon-EXECUTE revocation
(only `keepalive` is anon-callable, by design).

> **Correction (second pass, 2026-08-04).** The line above originally also
> claimed `delete_sales_order`'s payment guards were verified clean. They
> were not — I never read that function in the first pass and should not
> have listed it. The second pass found it genuinely defective (it could
> cascade-delete customer payments; fixed in migration 0129, section 5c).
> Recorded here rather than quietly edited, because an audit that overstates
> its own coverage is worse than one that admits a gap.

**Every fix was verified against live data** (not just read as correct):
before/after query proofs for the timezone shift, the tier-price gap, the
dashboard/P&L convergence, the returns-netting formula (via a rolled-back
`begin;...rollback;` payment test), and stock totals before/after the view
collapse (20,260 pieces, unchanged).

---

## 5c. Audit — second pass (2026-08-04), migrations 0128–0129

Ali asked whether the first pass really covered the *whole* app. It did not —
it covered ~55 of ~85 database functions and none of the app's own write
paths. This pass closed the rest: the order void/delete/edit paths, the admin
cascade-deletes, access-control helpers, the remaining reporting functions,
all 8 views, plus two things the first pass never looked at at all — the
**frontend money math** and the **offline write queue**. Findings were
verified against live data before any fix, and after.

**The worst bug in the app was here, not in the SQL: offline writes were
silently destroyed.** `drainQueue` replayed every queued write using the
**anon key** as the Bearer token (`lib/use-network-status.ts`), not the
signed-in user's JWT. Confirmed at the database level: `anon` holds
table-level INSERT/UPDATE on `sales_orders`, gated only by RLS — so the
requests really did reach Postgres and really were filtered to nothing.
Consequences, both verified in the code:
- INSERTs came back 4xx, and the old code **deleted 4xx entries from the
  queue** and moved on;
- PATCHes matched zero rows under RLS and returned **204 No Content**, which
  the old code counted as **success** and removed.

So a driver could record MVR 8,000 of collected cash in a dead zone, see
"Saved offline", later see "All changes synced", and nothing ever reached
the database. Fixed: replay now uses the real session token; refuses to
drain at all without one; never deletes an entry that didn't verifiably
apply (`Prefer: return=representation`, and a PATCH matching zero rows is a
failure, not a success); stops at the first failure so a later write can't
overtake the earlier one it depends on; and the banner now shows a red
"couldn't sync — Retry" state instead of a green success it hadn't earned.
The New Sale offline toast no longer implies the sale is complete.

**Root cause of SO-2026-076 is now closed properly (migration 0128).** New
`create_and_post_sale(p_order, p_lines, p_offline_key)` does the order, its
lines and the FIFO stock deduction in ONE transaction, replacing three
sequential client writes. Proven by test: forcing a mid-flight failure
(insufficient stock) rolled everything back — zero orphan orders, and the
app-wide check "orders with revenue but no stock movements" is now **0**.
`p_offline_key` (unique) makes a replay idempotent instead of a duplicate
sale. `qty_pieces` and `line_total_mvr` are now computed in Postgres from
the SKU's own pack/carton configuration instead of being sent from the
browser (hard rule 1); the unit price is still an input, because that is a
real human decision.

**Also fixed (migration 0129):**
- `delete_sales_order` could **cascade-delete customer payments**. It only
  checked the header fields `payment_status IN ('paid','deposited')` and
  `cash_collected_mvr > 0`, but `'partial'` and `'cod'` are legal values —
  a part-paid order passed both guards and `order_payments` rows cascaded
  away with no trace. Same bug class as `admin_force_void_grn` (fixed in
  0124). Now sums the payments ledger, like `void_sales_order` already did.
  **Behaviour change:** a *delivered* order can no longer be deleted at all
  — voiding is the correct action (it reverses stock and keeps the record).
- `get_tier_prices_for_skus` — the live pricing path — returned **no piece
  or pack price at all** for a SKU priced only per carton (e.g. Sosoft Blue
  700ml at MVR 220/carton), because it derived prices upward from the piece
  price but never downward from the carton. Now derives both directions.
  Verified: 0 active SKUs now return a null price, and 0 SKUs were in the
  state where the new fallback could change an existing price.
- `v_verification_history` carried a stray `SELECT` grant to `anon`.
- Role guards that used `IF NOT is_admin_or_manager()` evaluated to NULL
  (not false) when `auth.uid()` is null, so the guard silently passed. Only
  reachable as postgres/service_role, never anon — but a guard that can be
  NULL is not a guard. Now `coalesce(..., false)`.

**Known and NOT yet fixed** (deliberately listed rather than buried):
- Four functions still bucket dates by UTC instead of Maldives time:
  `get_returns`, `get_recent_writeoffs`, `get_customer_products`,
  `get_competitor_price_freshness`. Proven off-by-one on the one real
  write-off in the database. Same one-line fix as migrations 0123/0126.
- The COD cash figures shown to drivers (`my-deliveries.tsx`,
  `dispatch-view.tsx`) and the payment/cash prefills in `sale-detail.tsx`
  are summed in TypeScript from gross line totals — they don't subtract
  payments already made or returns, so a part-paid COD order tells the
  driver to collect the full amount. `my-deliveries.tsx` also writes
  `payment_status: 'paid'` unconditionally, even when the driver records a
  short collection.
- The GRN screen's landed-cost preview and its suggested customs-duty
  figure use **ordered** cartons while `confirm_grn` uses **actual received**
  cartons — so on a short-received shipment the preview Ali confirms against
  is wrong. The duty figure is saved and feeds permanent landed cost.
- The margin/price simulator computes a saved selling price in TypeScript,
  duplicated in two files (`sales-list.tsx`, `competitors-view.tsx`).
- `app/(app)/dashboard/page.tsx` calls Supabase directly instead of going
  through `lib/queries/` (hard rule 4).

---

## 5d. Audit pass 3 (2026-08-04) — migration 0130, everything in 5c closed

Ali asked for every remaining known defect to be fixed. All of them were,
and the "known and NOT fixed" list in 5c is now empty:

- **Timezone sweep finished (0130).** `get_returns`, `get_recent_writeoffs`,
  `get_customer_products` and `get_competitor_price_freshness` were still
  bucketing by UTC. Proven fixed on real data: the one write-off in the
  database (21:14 UTC on 26 Jul) now correctly reports under **27 Jul**
  Maldives time instead of 26 Jul.
- **Driver COD cash is now the real balance, not a gross sum.** Both
  `my-deliveries.tsx` and `dispatch-view.tsx` took the amount to collect from
  a browser-side sum of gross line totals, ignoring payments already recorded
  and returned goods — so a part-paid COD order told the driver to collect the
  full amount and flagged a correct collection as short. Both now read
  `v_order_balances.balance_mvr` (new `getOrderBalances()` helper for the
  list, `getOrderBalance()` at confirm time).
- **A short collection no longer closes an order as fully paid.** Both screens
  wrote `payment_status: 'paid'` unconditionally; they now write `'partial'`
  when the cash is less than what was owed, so the shortfall stays in
  receivables instead of silently vanishing.
- **Sale Detail prefills fixed.** The payment sheet fell back to the gross
  order total when the balance hadn't loaded (one tap could over-collect — it
  now leaves the field blank, with the server-side overpayment guard as the
  backstop), and the cash-collected field used `totals.mvr.toFixed(0)`, which
  both ignored prior payments and rounded MVR 776.50 down to 776.
- **GRN preview and suggested duty now use cartons ACTUALLY received.** Both
  used ordered cartons while `confirm_grn` uses
  `coalesce(qty_cartons_actual, qty_cartons)` — so on a short-received
  shipment the landed-cost preview Ali confirms against was wrong, and the
  suggested customs-duty figure (which is saved, and feeds permanent landed
  cost) was inflated.
- **Dashboard no longer calls Supabase directly** (hard rule 4). It is a React
  Server Component, so it could not use `lib/queries/` — every module there is
  `"use client"`. New `lib/queries/dashboard-server.ts` is the missing
  server-side half of the query layer.

**Still open, deliberately:** the margin/price simulator computes a saved
selling price in TypeScript and is duplicated in `sales-list.tsx` and
`competitors-view.tsx`. Both copies are currently identical and the number is
Ali's own decision, so there is no wrong figure today — the risk is future
drift between the two. Worth unifying into one helper (or an RPC) next.

**Not device-verified:** the offline sync paths and the COD screens need a
real phone (airplane mode → record → reconnect) to confirm end to end.

---

## 5e. Destructive-action safety (2026-08-05), migrations 0133–0134

Started as UI work on confirmation buttons; turned up a stock-integrity bug.

**The bug (0134).** "Remove item" on a sales order is only offered while the
order is `confirmed` or `picked` — exactly when `post_sale` has already
deducted the stock. But the app removed the line with a plain table delete
(`from("sales_order_lines").delete()`), leaving the `out` stock_movements
behind. The goods ended up in neither place: off the order and out of
inventory, permanently, with no audit row. Its sibling `edit_sales_order_line`
had always reversed movements correctly; the delete path never did.
Verified before writing the fix: **zero** orders in production had orphaned
movements, so nothing needed repairing. New RPC `delete_sales_order_line`
reverses the line's FIFO movements, refuses on any status other than
confirmed/picked, refuses to empty an order down to zero lines, and writes an
audit row. `lib/queries/sales.ts` now exposes `removeOrderLine` (RPC) beside
`deleteOrderLine` (draft-only, still a safe table delete) — do not collapse
these two back into one.

**Impact previews (0133).** `get_shipment_void_impact` and
`get_sales_order_delete_impact` return what a destructive action would
actually destroy — pieces on hand, orders deleted, MVR erased — plus a
`blocked_reason` string that mirrors, phrase for phrase, the RAISEs in
`admin_force_void_grn` / `delete_sales_order`. **If those guards change, these
strings change with them.** The sheets show the reason up front instead of
letting someone commit to a press-and-hold and then eat an error toast.
Both are SECURITY DEFINER with `is_admin_or_manager()` inside and anon
revoked — the preview is exactly as privileged as the action it previews.

Live figures at the time of writing, which are the argument for the feature:
`SH-2026-001` carries **20,254 pieces on hand and 70 orders worth MVR
35,929**. One tap used to target all of it, with the red button drawn at twice
the width of Cancel.

**The three tiers, and why not more friction.** Hold-to-confirm (1.2s,
`components/ui/hold-to-confirm.tsx`) goes on exactly two buttons: delete a
received shipment, and delete a non-draft sales order. Everything else keeps a
plain tap. This is deliberate — friction only works while it is rare; a hold
on every delete trains the thumb to hold and then protects nothing. Do not
extend it without a reason.

**Button weight is now inverted for destructive rows** (`dangerQuietBtn` in
`sale-detail.tsx`, and the same treatment inline in `shipment-detail.tsx`):
the safe action takes the wide solid `primaryBtn` slot, the destructive action
is a narrow outlined red button. This deliberately breaks the app's usual
"primary action is wider" rule — which is how the bug arose in the first
place, that rule having been applied to buttons whose primary action is
destruction.

**Also fixed:** Delete Purchase Order had no in-flight flag at all, so two
quick taps sent two delete requests. And "GRN" is gone from the destructive
copy — anything tapped under pressure now says "shipment".

**iOS constraint worth remembering:** `navigator.vibrate` is a no-op in Safari,
so the hold has *no* haptic on Ali's phone. The fill bar is the entire
feedback channel, which is why it is the button's own background at full
opacity rather than a hairline progress track.

**Not device-verified:** the hold gesture itself. Pointer-event capture and
`touch-action: none` are correct in principle but the feel — whether 1.2s is
right under a thumb — needs Ali on the real phone.

---

## 5f. Costing sandbox + native iOS gestures (2026-08-05), migration 0135

**Costing sandbox** (`/costing`). Ali asked for a way to try FOB prices,
container freight share and fixed freight against his SKUs without touching
real costing.

The design decision that shapes it: **you cannot honestly cost one SKU alone.**
Freight, duty, MPL, agent and last-mile are shared container costs —
`confirm_grn` splits freight/local by each line's share of total CBM and duty
by each line's FOB×duty-rate. Change one line's cartons and every other line's
cost moves. A per-SKU "container share" box would produce numbers that never
add up to a real container. So it models a whole shipment: list the SKUs, give
the shipment costs once, and every line is apportioned exactly as the real GRN
will apportion it.

`simulate_landed_costs(jsonb, jsonb)` is a **pure** function — STABLE, SECURITY
INVOKER, and containing no write statement of any kind, so it cannot touch real
costing even by accident. **It is a line-for-line mirror of `confirm_grn`'s
apportionment. If that changes, this must change with it or the sandbox starts
lying.**

Proved by replaying SH-2026-001's own inputs through it: **30 of 31 lines
reproduce the locked GRN cost to 4 decimal places.**

The 31st is the known `MAMY-XTRA-XXXL-34x3` discrepancy, found independently
by the simulator. The GRN booked 1 carton as **128 pieces**; the SKU record now
says 34 × 3 = **102**. So the config was changed after the GRN. Consequences:
the batch's locked cost (4.2509/pc) was computed on 128, the simulator says
5.3345/pc on 102, and about **MVR 69** of stock value is understated on the 64
pieces still on hand. The forward problem is bigger than the money: **every
future carton of this SKU will be booked 26 pieces short.** Still Ali's call
which number is right — do not guess it.

Also: only **1 of 31 SKUs** has an explicit `target_margin_pct`, so
"price for target" falls back to the margin the SKU earns today and reports
which basis it used via `price_basis` ('target' | 'current'). The screen must
not claim a target that was never set.

`costing_scenarios` is a standalone RLS'd table feeding nothing — deleting
every row in it cannot affect a single landed cost.

**Pull-to-refresh** (`lib/use-pull-to-refresh.ts` +
`components/layout/pull-to-refresh.tsx`). Rides iOS's own rubber-band rather
than replacing it: **every listener is passive and nothing calls
preventDefault**, because the standing rule is that the bounce stays on. iOS
reports a negative document scrollTop while overscrolling, so the pull distance
is read off the scroll the browser is already animating. Engines that clamp at
0 fall back to touch delta. The indicator is `position: fixed`, which on iOS
does not travel with the bounce — content pulls away and reveals it, which is
why it looks native for free. Screens opt in with `useRefreshHandler(load)`;
`router.refresh()` runs always so server-rendered screens (Dashboard) refresh
too.

**Swipe actions** (`components/ui/swipe-actions.tsx`), on Sales rows.
Three constraints that make it work rather than fight the browser: **left
swipe only** (a right swipe collides with iOS Safari's edge-swipe-back, which
the user cannot disable and which wins); **`touch-action: pan-y`** so the
browser keeps vertical scrolling and the bounce; and an **axis lock** where
vertical wins ties, so a fast vertical flick that drifts sideways doesn't snag
a row. Actions are Call and WhatsApp — deliberately no money action, because
recording a payment needs an amount and a method, which is a sheet, not a
swipe.

**Typography.** Money that stacks in a column now carries tabular figures
(products-explorer, inventory brand totals, sale-detail line totals,
sales-list line rows, competitor prices, financials revenue rows). Prose was
deliberately left proportional — San Francisco reads better that way in a
sentence, and tabular only earns its keep when digits must line up between
rows. Two places below Apple's 11pt Caption 2 floor (a 9pt badge in
sale-detail, 9.5pt labels in competitors-view) were lifted to 11pt. A scan for
hierarchy inversions — a label set larger than the value beneath it, the exact
defect that made the Sales card unreadable — now returns **zero**.

**Not device-verified:** the pull-to-refresh gesture and the swipe threshold.
Both depend on iOS touch behaviour that cannot be reproduced here.

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
payments** (allowed; waiting on a BML merchant account) · **per-100ml/100g competitor
pricing** (detergent categories are set up for it; no rival prices logged that way) ·
**extra supplier currencies** (MYR/THB/CNY/EUR).

1. **Nothing pending from the removed web shop.** See section 5 — it is fully
   gone. The only open item is Ali deleting the leftover Vercel project shell.

---

## 8. Working with Ali

Plain English, lead with the answer, ONE recommendation, money-first (rufiyaa before %).
Use genuine expert judgement — do NOT just agree; push back with reasons when warranted;
research to current standards, don't hand-wave. His screenshots are the QA channel. Never
claim a mobile fix works without verifying, and say plainly when device verification wasn't
possible and what would unlock it.

**No mockups (2026-08-05).** Ali briefly asked to see mockups before changes,
then reversed it the same day: *"I can't view mockup on iPhone. You need to
always upload production. Skip creating mockups from now on."* He runs the
business from an installed iOS PWA and cannot open preview links or hosted
artifacts. Build the change, verify it (tsc + build + live SQL against real
rows), publish to production, and describe it in words. Do not spend a turn
producing a mockup he cannot open.
