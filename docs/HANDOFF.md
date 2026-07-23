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
- **Supabase:** project id `smhdwkrmiytvpsgqezsl` (Postgres 17). Migrations in
  `supabase/migrations/`, applied live via the Supabase MCP in the same work unit.
  Latest applied: **0089**.
- **Vercel:** project `prj_rlOeqBEzmdNbbQMagyCC2nsuecGk`, team
  `team_qyYXhgTXNYb5dCxNgfIMmQxk`. Prod aliases: `saynomore-beta.vercel.app`,
  `saynomore-kudanulafaa-zahabs-projects.vercel.app`.

**Access carries over automatically — no passwords are stored here (public repo).**
GitHub, Supabase and Vercel are reached through the session's MCP connectors, which
reconnect on their own in a new chat under the same account. Real secrets (API keys,
service-role keys, DB passwords) live in the Vercel/Supabase project settings and the
environment — never commit them here.

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

## 5. Built this session (recent → older highlights)

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

## 6. Open / next tasks (priority order)

_Done this session: #1 editable expense date, #2 cash-flow/runway forecast (0089),
#3 trend-aware reorder velocity (0090), #4 campaign confounder flags (0091), #5 Price Book
UX polish. Notes carried forward: the cash forecast's inflow model has a known, labelled
minor overlap (ongoing sales run-rate + current receivables both counted) — transparent, not
hidden; supplier payments timed to expected arrival (a visible assumption). The reorder trend
is upward-only (never orders less than before); true calendar seasonality is deferred until
there's multi-year history._

1. **Customer storefront** — **ON HOLD (Ali, 2026-07-23): do not start; Ali will decide
   if/when he wants it.** Scoped in `docs/STOREFRONT_PLAN.md` for whenever that happens.
   Separate installable PWA sharing the same Supabase;
   `place_customer_order` server-side pricing + atomic order, `order_source='web'` into
   Dispatch (column already live; all rows currently `walk-in`). Phase 1 = COD/transfer;
   cards later (needs BML merchant account). Sosoft sold by carton of 6, mix or single colour.
   **Blocked on 5 product decisions** (guest vs accounts, web price, fulfilment godown,
   reserve-at-placement vs confirm, payment) — see the plan. Backend-first when greenlit;
   the customer-money path must not ship on guesses.

---

## 7. Working with Ali

Plain English, lead with the answer, ONE recommendation, money-first (rufiyaa before %).
Use genuine expert judgement — do NOT just agree; push back with reasons when warranted;
research to current standards, don't hand-wave. His screenshots are the QA channel. Never
claim a mobile fix works without verifying, and say plainly when device verification wasn't
possible and what would unlock it.
