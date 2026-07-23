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
  Latest applied: **0088**.
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

1. **Editable date on the business-expense Quick Log.** `business_expenses.expense_date`
   exists and drives the P&L, but the Quick Log card stamps `CURRENT_DATE` only — no way to
   back-date or correct. Add a date field (default today, editable). Small, high value.
2. **Cash-flow / runway forecast** for imports — the real blind spot: "will I have cash to
   pay the next shipment?" Build from the ledger (receivables in, payables/shipments out).
3. **Seasonality** in the reorder engine — velocity is a flat 90-day average; add trend/season.
4. **Campaign confounder flags** — auto-caveat a boost verdict when it overlapped a stockout
   or a price change (before/after can't otherwise separate cause).
5. **Price Book UX polish** — tappable KPI-stat filters, in-page search + sort, clearer
   labels on secondary numbers. (A codebase-aware prompt for this was drafted in chat;
   keep healthy=quiet, don't add green "healthy" badges, preserve the desktop table.)
6. **Customer storefront** (deferred, Ali-approved direction): separate installable PWA
   sharing the same Supabase; `place_customer_order` server-side pricing + atomic stock;
   web orders tag `order_source='web'` into Dispatch. Phase 1 = COD/transfer; cards later
   (needs BML merchant account). Sosoft sold by carton of 6, mix or single colour.

---

## 7. Working with Ali

Plain English, lead with the answer, ONE recommendation, money-first (rufiyaa before %).
Use genuine expert judgement — do NOT just agree; push back with reasons when warranted;
research to current standards, don't hand-wave. His screenshots are the QA channel. Never
claim a mobile fix works without verifying, and say plainly when device verification wasn't
possible and what would unlock it.
