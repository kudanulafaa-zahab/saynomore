# SKILLS.md v3 — SayNoMore Expert Council

**Project:** SayNoMore — FMCG Import & Distribution Operations Platform (Maldives)
**Owner:** Ali — non-technical, runs the business daily from an installed iOS PWA.
**Supersedes:** skills.md v2. Read alongside `CLAUDE.md`.

Every rule in this file was proven on this app in production during the
2026-07-11/12 overhaul sessions — verified on Ali's real device, real margins,
real data. These are not aspirations; they are laws with case history. When a
new decision conflicts with one of these, the law wins unless Ali overrules it.

---

## Step Zero — Detect before prescribing

1. Read `package.json` for actual versions before writing against any API.
   (As of v3: Next.js 16 App Router + Turbopack + **React Compiler enabled**
   in `next.config.ts`, React 19, Tailwind v4, Supabase, TS strict.)
2. Extend the existing token system in `app/globals.css` — never fork a second one.
3. State findings briefly, then proceed.

---

## Seat 1 — Apple Design (2026 HIG doctrine)

The standing laws, each with the incident that created it:

- **The accent is GRAPHITE MONOCHROME — no hue.** Ali rejected systemBlue
  (three times) and then systemIndigo (2026-07-12): any hue-based accent
  reads as decoration to him. `--snm-brand` = `var(--foreground)` (black in
  light, white in dark), `--snm-brand-on` = background, tints via color-mix.
  Interactive text signals through WEIGHT, not hue. The payoff for a money
  app: green/red/orange are the only hues on screen — color always means
  money. Do not propose a new accent hue; the debate is settled.
- **Color communicates affordance.** Indigo/brand = tappable or "us". Neutral
  gray = information (static tiles, hints, previews, metadata badges like
  FIXED/VOL./MIXED CTN). Semantic colors mark true status only: green = good
  money/on, red = loss/destructive, orange = attention/cash-to-collect,
  systemBlue = pure info status (sync). A static panel painted in accent
  color is a bug (the "Pick up from"/"Bank Transfer" incident).
- **[OVERRULED by Ali, 2026-07-20] Backdrop-blur on content cards is now ON.**
  The former law ("blur on floating chrome only — never on content") was based
  on attributing the July scroll stutter to per-card blur; Ali's re-diagnosis
  is that the stutter was the tab bar waiting on load-time paint bursts, not
  card blur, and he explicitly asked for real per-card glassmorphism. Current
  doctrine: in-flow cards carry light blur (14px × frost dial) while floating
  chrome carries heavier blur (22-28px) — native iOS layering. If sustained
  scroll jank is ever MEASURED again, bring evidence to Ali before changing
  this back; do not silently re-impose the old law.
- **Luminous glass on content = translucency, not blur (2026-07-13).** Ali
  asked for glassmorphic content cards system-wide. The sanctioned recipe
  gives that look with zero per-card blur: one fixed atmospheric page gradient
  (`--app-bg`, painted by `body::before`) sits behind translucent surfaces so
  depth peeks through, plus a specular top sheen (`--glass-sheen`) and the 1px
  inner hairline (`--glass-inner`). `.snm-card`/`.glass` layer sheen over
  `--glass-bg-1`. The gradients are NEUTRAL luminance only — no hue — so the
  monochrome-accent law holds and green/red/orange stay the only meaning-
  bearing colours. Do not "fix" content translucency by adding `backdrop-filter`
  back; that reintroduces the jank the law above forbids.
- **Rubber-band bounce stays ON.** It is the iOS signature. A commit once
  set `overscroll-behavior: none` believing bounce was "web feel" — that is
  backwards and it made the app feel dead. Never reintroduce it.
- **Sheets arrive, they don't appear.** Bottom sheets use `.snm-sheet-in`
  (spring), backdrops use `.snm-scrim-in` (fade). All motion via the tokens
  `--snm-spring`/`--snm-ease-out` — never hardcode a bezier. Animate
  transform/opacity only. `prefers-reduced-motion` flattens everything
  automatically (global rule exists — don't duplicate it).
- **Text tokens are sacred.** `--snm-brand-text` and the deepened light-mode
  semantic text variants were contrast-verified on a real device in Maldivian
  daylight. Never swap them for the fill variants or "brighter" values.
- Accessibility fallbacks exist and must survive refactors:
  `prefers-contrast: more` and `prefers-reduced-transparency: reduce` blocks
  in globals.css.
- Apple type scale via the `ios-*` classes; page titles use `.ios-page-title`;
  money uses `.snm-num` (tabular). 44pt touch targets. Safe-area insets on
  every fixed/floating element.

## Seat 2 — Frontend Engineering (React 19 / Next 16)

- React Compiler is on: write plain components; don't add manual `memo`/
  `useMemo` for performance without a measured reason.
- **No synchronous setState inside effect bodies.** Loaders: initial state
  `true`, set false in `.finally` — refetches swap in place (no skeleton
  flash after saves). Mounted flags via `useSyncExternalStore`.
- Never read refs during render; derive from state.
- `next/link` for all internal navigation; heavy libs (`@zxing`) stay behind
  `dynamic()`.
- One canonical implementation per pattern: press feedback `.snm-pressable`,
  cards `.snm-card`, confirms `ConfirmSheet`, notifications `lib/push.ts`,
  spend entry `SpendSheet` (exported once, mounted where needed).
- Verify every change: `npx tsc --noEmit` + `npm run build` minimum; eslint
  on touched files (pre-existing dialog form-sync warnings are known and
  parked pending click-testing — don't blind-refactor money dialogs).

## Seat 3 — Backend / Postgres (Supabase)

- **All money and stock math in Postgres. No exceptions.** UI ships numbers
  to the screen; it never computes them. Every engine is an RPC or view:
  `confirm_grn`, `post_sale`, `get_pnl`, `get_pricing_health`,
  `apply_target_prices`, `get_receivables_aging`, `get_promo_suggestions`,
  `get_morning_briefing`, `v_expiring_stock`, `v_batch_stock`, `v_skus`.
- Every new SECURITY DEFINER function: `SET search_path`, wrap auth calls as
  `(select auth.uid())` (initplan), and **REVOKE EXECUTE FROM anon in the
  same migration** — get_pricing_health shipped anon-readable for half a day;
  never again.
- Migrations: file in `supabase/migrations/NNNN_*.sql` AND applied live via
  MCP in the same work unit. Run advisors after DDL.
- Immutable once posted; corrections are reversing entries. Stock =
  SUM(stock_movements). Forex locks at GRN. Audit_log on money/stock
  mutations with old→new in the reason.
- FEFO switch for depletion is planned but deliberately deferred until
  expiry_date coverage is real (capture shipped 2026-07-12; engine is FIFO).

## Seat 4 — Finance & Accounts

- **Speak rufiyaa first, percentages second.** "Loses MVR 9/pack" beats
  "-5.8% margin" — Ali flagged the jargon with a screenshot. Percentages are
  for comparing across products, shown alongside money, never instead of it.
- **Losing money is a decision, never an accident.** Any path that adds a
  below-cost line pauses with the real numbers and an explicit red "Add at a
  loss". One guard, every door (the quick-add-only guard was a caught bug).
- Fixed selling prices are Ali's and are never auto-overwritten. The system
  *watches* (Margin Watch) and *suggests* (one-tap reprice at target margin,
  audit-logged); it does not act alone.
- Every figure traceable to ledger rows: P&L ← orders/payments/expenses/
  pro-rated marketing; Owed ← order totals minus payments ledger; COD recon
  per driver per day.
- Landed cost basis: FOB + CBM-apportioned freight/local + duty-weighted
  duty at the GRN-locked rate — never recompute after confirmation.

## Seat 5 — Inventory & FMCG Operations

- Stock lives in movements; batches carry landed cost and (now) expiry.
- Watch the money in the stock: days-of-stock from 90-day real velocity;
  >180 days (or zero sales) = slow mover → Promo Advisor with a clearance
  price that still clears a 10% floor margin.
- Expiry: captured at the shipment line (optional field, GRN dialog),
  inherited by batches via trigger, surfaced ≤120 days in `v_expiring_stock`
  and ≤60 days in the morning briefing.
- Multi-godown always distinguishable; a SKU in another warehouse is
  sellable, not out of stock.

## Seat 6 — Sales & Operations

- **Module rule: Market decides, Expenses records.** Market = Promo Advisor,
  campaign logging, competitor prices (the thinking). Expenses = pure
  money-out ledger where campaign spend lands automatically (the record).
  Don't drift functions back across this line.
- The dashboard briefs, it doesn't decorate: one sentence about yesterday +
  a watch list that deep-links (Owed, Inventory, Promo Advisor). Silent when
  healthy — every alert must be actionable or absent ("No data" showcases
  are banned; that was the Expenses channel-row incident).
- Notifications span the whole cycle and all ride `lib/push.ts` (one send
  path, admin fan-out + dedup, fire-and-forget): driver assigned → driver;
  delivered / payment / void / delete / GRN-with-Margin-Watch-summary →
  office; daily 07:00 MVT low-stock digest (pg_cron, Vault-fed).
- **Every push carries a category** (`delivery` | `money` | `stock`) and the
  send-push edge function gates it against `user_notification_prefs`
  (migration 0082) — never bypass that gate with a category-less send.
  `delivery` is the critical class: users can't switch it off (Settings shows
  it locked "Always on"); admins can, per user, from Team Members. No pref
  row = enabled — that's the on-by-default. Settings is the notifications
  home (one-tap enable + toggle list); the app silently re-subscribes on
  every open once iOS permission exists (`NotificationsBootstrap`).
- Order entry is speed-first: quick-add is one tap when healthy; friction
  appears only when money would be lost.

---

## Working with Ali

- Plain English, lead with the answer, ONE recommendation. Never make him
  choose between technical options.
- His screenshots are the QA channel — treat each as a bug report with
  perfect evidence (7-for-7 in the overhaul sessions).
- Publish everything after each confirmed working change: commit straight
  to `main` and push → Vercel production deploy → verify READY. No
  intermediate branch push (2026-07-17: Ali asked to stop generating
  preview deployments — commit directly to production every time, no
  detour through a feature branch). Supabase changes go live immediately
  via MCP.
- Never claim a live/mobile fix works without verifying — and say plainly
  when verification wasn't possible and what would unlock it.

## Definition of Done

- [ ] Reflects how the business actually operates? (FMCG)
- [ ] Traceable, reversible, audit-logged? (ERP/Finance)
- [ ] Money math in Postgres, anon revoked, RLS intact? (Backend)
- [ ] Obeys the color/glass/motion laws; feels native on the phone? (Design)
- [ ] Plain-money language; loss requires a decision? (Ali's seat)
- [ ] tsc + build clean; published to GitHub/Supabase/Vercel and verified?
