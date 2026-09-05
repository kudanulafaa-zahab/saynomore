# SKILLS.md v4 — SayNoMore Expert Council

**Project:** SayNoMore — FMCG Import & Distribution Operations Platform (Maldives)
**Owner:** Ali — non-technical, runs the business daily from an installed iOS PWA.
**Supersedes:** skills.md v3. Read alongside `CLAUDE.md`.

Every rule in this file was proven on this app in production — verified on
Ali's real device, real margins, real data. These are not aspirations; they are
laws with case history. When a new decision conflicts with one of these, the
law wins unless Ali overrules it.

**Nine seats, and the last three were added on 2026-09-03 because they were
missing.** Ali, 2026-08-06: *"before you agree to me you must always use expert
knowledge in all relevant fields"* — and the council only works if it covers
the fields. Every defect he caught in the week to 2026-09-03 fell through a gap
BETWEEN the six seats rather than being missed by one of them:

| what he caught | which seat should have | there was no such seat |
|---|---|---|
| "MVR 229.99" for a 230.00 carton | the parts must sum to the whole | **Seat 8, Numerical Integrity** |
| a 22px "Below cost" warning, a card no screen reader can name | every control named and hittable | **Seat 7, Accessibility** |
| "what is single tub and tub and carton" | the test asserted the defect and passed | **Seat 9, Verification** |

A seat is added when something reaches Ali that a competent specialist in that
field would have stopped. It is not added because the title sounds thorough.

---

## Step Zero — Detect before prescribing

1. Read `package.json` for actual versions before writing against any API.
   (As of v3: Next.js 16 App Router + Turbopack + **React Compiler enabled**
   in `next.config.ts`, React 19, Tailwind v4, Supabase, TS strict.)
2. Extend the existing token system in `app/globals.css` — never fork a second one.
3. State findings briefly, then proceed.

---

## Seat 1 — Design System (SayNoMore, est. 2026-09-05)

**SUPERSEDED THE APPLE HIG DERIVATION ON 2026-09-05, BY ALI'S EXPLICIT
INSTRUCTION:** *"I don't want you to follow any of my previous rules like
Apple or any other. I want you to convene the top ui/UX teams and prepare a
fresh one and execute. But it must look excellent when on Retina mobile and
scale automatically on platform used like tablet or desktop."*

**The system now lives in `app/design-system.css`. Read it before any UI work.**
Its four principles are derived from how Ali works, not borrowed from a vendor:
one hand in bright daylight; the NUMBER is the content; scale is continuous
rather than stepped; density follows the INPUT device, not the screen width.

What it changed, and why it was needed — measured before it was written:
`clamp()` appeared 0 times in the stylesheet, container queries 0 times, and
131 hardcoded viewport breakpoints carried the whole responsive story. So the
app did not scale, it jumped — and only in layout, never in type, leaving 15px
rows on a 1440px monitor.

Type and space are now fluid functions of the viewport, IDENTICAL at 390px so
Ali's phone did not move by a pixel, growing to 1280px and capped there.
Line-height is a ratio, never a pixel count. Components size from their
CONTAINER via `.snm-region`, so one component is correct on a phone, in a
tablet split-view and in a desktop sidebar without being told which.

The laws below SURVIVE the change because each was earned on this app with a
real incident, and none of them was Apple's — they were only written in
Apple's vocabulary:

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
  `(select auth.uid())` (initplan), and **`REVOKE EXECUTE … FROM public, anon`
  in the same migration**. BOTH, always — this is the 84-migration house
  pattern and the only spelling that actually closes the function.

  **There are TWO independent grants, and removing either one alone leaves it
  open.** This cost two attempts on 2026-09-01, so both halves are written
  down:

  1. `CREATE FUNCTION` grants EXECUTE **to PUBLIC** by default. Every role
     inherits it, `anon` included.
  2. Supabase's `ALTER DEFAULT PRIVILEGES` grants EXECUTE **to `anon` in its
     own right** on top of that.

  The rule used to say `anon` alone, which removes (2) and leaves (1) — so
  `get_setup_gaps` and `set_category_sellable_units` reached production
  callable by anyone holding the publishable key, the first of them SECURITY
  DEFINER with no role check, exposing the whole catalogue. Revoking PUBLIC
  alone removes (1) and leaves (2), which is what the second attempt did:
  `CREATE OR REPLACE` preserves existing grants, so `anon`'s own grant
  survived from an earlier migration and the new guard failed on a fresh
  replay. Only `from public, anon` clears both.

  **Never reason about the ACL — ask the question.** rls_surface.test.sql
  asks `has_function_privilege('anon', …)`, which is the real question and
  caught both attempts. The ACL is still worth reading when debugging: a
  leading bare `=X` in `{=X/postgres,…}` IS the PUBLIC grant, and a separate
  `anon=X/postgres` entry is the second one.
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
- **Freight and forex are VOLATILE and every shipment stands alone** (Ali,
  2026-08-12). A rate that differs from last time is normal, not a data error —
  saying otherwise once cost credibility. Never carry one shipment's rate onto
  another, even as an estimate. **Landed cost is a property of an ARRIVAL, not
  of a product**, so margin is not stable and a price set once goes stale: the
  right moment for a price review is when stock lands. Freight is charged by
  VOLUME, not value, so a freight rise punishes cheap bulky goods first — the
  2026-08-16 container would have taken Sosoft from ~40% margin to 10.4% at
  unchanged prices. Full rule and the incident: CLAUDE.md.

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

## Seat 7 — Accessibility

Added 2026-09-03. Every seat above assumed someone else owned this and nobody
did, so it failed three separate ways in a single week — and each failure hurt
Ali directly, not some hypothetical user. He runs this one-handed, in a godown,
often in bright daylight, on the phone in his pocket.

- **Every interactive control has an ACCESSIBLE NAME.** The New Sale product
  card had none for a year. VoiceOver read it as a price, a provenance badge
  and a stock line, with the product itself buried in the middle — and because
  nothing could address it by name, no test could reach that step either. One
  missing attribute was simultaneously an accessibility defect and the reason
  the screen from Ali's screenshot was the one screen no audit could open. The
  qty steppers were "plus sign" and "minus sign".
- **An `aria-label` REPLACES the visible text for anything matching by name** —
  screen readers and tests alike. Adding one written with different words
  silently renames the control: an audit that found a row by
  "Mamypoko · Xtra Kering · L" clicked nothing for thirty seconds. Mirror what
  the screen shows, separator included.
- **If it is tappable it is 44×44, and if it cannot be, it is not a button.**
  "Below cost" — the warning that a price loses money — was a 125×22 button
  inside a caption line. It could not grow without wrecking the line, so it
  stopped being a button and the full-size line beneath it carries the action.
  An affordance you cannot hit is worse than one affordance you can.
- Contrast is measured, never judged (`npm run audit:contrast`), and the
  `prefers-contrast` / `prefers-reduced-transparency` / `prefers-reduced-motion`
  blocks in globals.css must survive every refactor.

## Seat 8 — Numerical Integrity

Added 2026-09-03, after a push notification told Ali he had been paid MVR
229.99 for a carton he sells at MVR 230.00. Seat 4 owns what the money MEANS;
this seat owns whether the arithmetic closes.

- **The parts must sum to the whole. A split is an ALLOCATION, not a
  division.** A mixed carton priced at 230.00 was divided by six, stored as
  38.3333 a bottle and added back to 229.99. No amount of stored precision
  fixes it — 230/6 does not terminate — so the answer is the largest remainder
  method, exactly as an invoice apportions VAT or a discount: floor shares
  first, then the leftover laari to the biggest remainders.
- **Any rule that breaks a tie must break it on something a person can SEE.**
  The first version broke ties on the row's id, a random UUID, so the same
  order allocated differently on two databases. It passed against production
  and failed in CI — not a flaky test, an unpredictable rule. Ties now break on
  quantity (the biggest share carries the rounding, which is what an accountant
  expects) and then the SKU code, which is printed on the label.
- **Money math in Postgres is not a style preference** (hard rule 1). This
  division ran in the browser, which is precisely how it escaped every
  money test in the suite.
- **A correction applies at every door, not at the call site you happened to
  fix.** The allocation is a statement-level trigger on insert, update AND
  delete: editing a quantity or removing a colour re-splits the carton too.

## Seat 9 — Verification & Test Design

Added 2026-09-03. The tests are not neutral — a badly written one makes the
defect a requirement, and two did.

- **Write the assertion from how the business works, never from what the
  screen currently does.** `new-sku.mjs` asserted *"the wizard offers 'Single
  tub'"* and passed every run for months. Ali then asked what "Single tub"
  meant, because it was one of three buttons for the same object. A test
  written from the screen locks the bug in and reports green while doing it.
- **Never set a baseline you have not measured.** Setting `new-sku` to 0
  without knowing its contents hid six more controls. A generous provisional
  number is honest — the ratchet fails when the real count comes in BELOW it
  and prints the truth — and it must not survive the run that measures it.
- **A gap recorded is not a gap fixed.** The plain product step was written
  into a baseline file as "not covered" after three CI rounds of guessing at a
  selector. That left the exact screen Ali had photographed unmeasured. The
  real cause was a missing accessible name (Seat 7), and looking for it beat
  three more guesses.
- **When a locator fails, make the page answer.** Failures now print what was
  on screen; the very next run said "the picker lists PRODUCTS, not SKUs" and
  ended the guessing.
- **Drive every migration and assertion against the live schema inside a
  rolled-back transaction before trusting it.** Docker is unavailable locally,
  so this is the only real rehearsal — and it has caught a constraint that
  accepted what it forbade, and an expected value I had reasoned out wrongly.

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
- [ ] Every control named and 44×44; contrast measured? (Accessibility)
- [ ] Do the parts sum to the whole, the same way on every database? (Numerical)
- [ ] Does each test assert the RULE, or just today's screen? (Verification)
- [ ] tsc + build clean; published to GitHub/Supabase/Vercel and verified?
