# SayNoMore — Session Handoff / Continuity

**Read this first when continuing in a new chat.** Pair it with `CLAUDE.md` and
`skills.md` (the standing laws), which load automatically.

## What this file is — and what it is NOT

Ali, 2026-08-05: *"There are many things missing from your handoff file… How can
I trust everything will be there in a new chat?"* Fair, and the honest answer
matters more than a reassurance:

**This file is a MAP. It is not the record, and it must never be treated as
one.** The record is:

| The real record | Why it cannot be lost |
|---|---|
| `app/globals.css` (2,271 lines) | Every design token, with the reasoning AND the date of each decision in the comments. Four palettes — **two different materials** — the frost dial, Display P3, the whole thing. |
| `skills.md` | The design/engineering laws with the incident that created each one. Loads automatically. |
| `supabase/migrations/*.sql` | Every money and stock rule, with a header explaining WHY. 157 files, latest `0166`. Applied live, tracked in git. |
| `git log` | Every change, with a full commit message explaining the decision. |
| The code itself | Comments carry the reasoning at the point of use. |

**All of that is committed and survives any chat ending.** A new session with no
memory of any conversation still has every one of them.

What a *summary* can lose is the **map** — knowing something exists so you go
and read it. That is what went thin here: section 3 was 22 lines describing
what is now 2,271 lines of design work, and never mentioned the palettes or the
Display P3 / Retina tuning at all. A new session would not have known to look.
Sections 2b and 3 were rewritten on 2026-08-05 to point at the real thing,
by line number.

**If you are that new session: do not trust this file's completeness. Read
`app/globals.css` before touching any UI, and `git log --stat` for anything you
are about to change.**

**The exact prompt to open a new chat with lives in `docs/NEW_CHAT.md`.**

### Start here

1. **§7 — What is left to do.** Written to be picked up cold. It separates what
   is Ali's call, what was offered and never answered, what is genuinely open,
   what is deferred and why, and what looks like a bug but was decided.
   **§11 is newer than §7 — read both; where they disagree, §11 wins.**
2. **§11 — the complete index of 2026-08-07 → 08-10.** The most recent work:
   the Soft palette, the contrast sweep, the browser audit gate, the sales-file
   split, backups. Use it as the completeness check for anything current.
   §5L is the same thing for 2026-08-05.
3. **§2b — every screen in the app.** §3 — the design system, by line number.
4. **The two test gates, and they are peers.** §10 — 173 pgTAP tests on every
   PR touching `supabase/`; read it before changing any money or stock
   function. **§12 — five browser audits on every PR touching the screens**;
   read it before changing any UI, and run `npm run audit:ui` before claiming
   a screen works.
5. Then `CLAUDE.md` and `skills.md`, which load automatically and carry the
   standing laws.

**Also read the migration headers before changing any money or stock rule.**
They are not changelogs — each one argues why, names the bug it fixes, and
records what was verified against live data afterwards.

---

## 1. Project & access

- **Owner:** Ali — non-technical, runs the business from an installed **iOS PWA**.
- **Business:** SayNoMore — FMCG import & distribution, Maldives (rufiyaa / MVR).
- **Repo:** `kudanulafaa-zahab/saynomore` (public). Develop and deploy on **`main`** →
  commit + push to `main` triggers a **Vercel production deploy**. No feature branches.
- **Supabase:** project id / ref `smhdwkrmiytvpsgqezsl` (org `yzyphsswhzbdhjbwqxlq`,
  region ap-southeast-1, Postgres 17). Migrations in `supabase/migrations/`, applied
  live via the Supabase MCP in the same work unit. **Latest applied: 0143** (the
  prospective-product costing — see section 5j; the money-math audit that
  ran to 0130 is in sections 5b, 5c and 5d).
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

## 2b. Every screen in the app — the module map

`components/layout/nav-config.ts` is the single source of truth; both the mobile
More sheet and the desktop sidebar derive their sections from the `section`
field on each item. **A page not listed there is invisible even if it is built
and routable** (the Price Simulator shipped that way — hard rule 8).

| Section | Route | What it is |
|---|---|---|
| Core | `/dashboard` | Morning briefing + watch list. Silent when healthy. |
| Core | `/sales` | Order list, New Sale composer, Sale Detail, returns, COD. |
| Core | `/inventory` | Stock by product and godown, batches, expiry, days-of-stock. |
| Core | `/dispatch` | Driver assignment board. |
| Finance | `/financials` | P&L, cash flow, runway, contribution margin. |
| Finance | `/reports` | Trends, days of stock, campaign ROI. |
| Finance | `/pricelists` | Customer tier prices (pack + carton; per-piece derived). |
| Finance | `/costing` | Price Simulator — landed-cost sandbox, incl. products not stocked yet. |
| Finance | `/expenses` | Pure money-out ledger; campaign spend lands here. |
| Procurement | `/reorder` | What to buy, from 90-day velocity with trend. |
| Procurement | `/shipments` | Purchase orders, container costs, GRN. |
| Procurement | `/suppliers` | Supplier master. |
| Catalogue | `/products` | 7-level SKU hierarchy, carton dimensions, photos. |
| Catalogue | `/godowns` | Warehouses. |
| Catalogue | `/stock-ops` | Transfers, write-offs, stock counts — the ledger door. |
| Catalogue | `/competitors` | Market: rival prices, Promo Advisor. Per-piece lives here. |
| Operations | `/customers` | Customer master + insights. |
| — | `/settings` | Notifications, palette picker, frost dial. |
| Staff role | `/deliveries` | Driver's own run sheet. |

Roles: `admin`/`manager` see everything, `viewer` sees all but `/dispatch`,
`staff` (drivers) see only `/deliveries`.

### 2c. The shared primitives — check here before writing a new one

There is **one canonical implementation per pattern**, and duplicating one is
how the bugs get in. Before you write a helper, a card style or a hook, look
here.

| File | What it owns | Why it exists |
|---|---|---|
| `lib/surfaces.ts` | `CARD`, `CARD_L2`, `CARD_ROUNDED` | The card recipe was copy-pasted as a local `const CARD` in **nine** files, so a palette change reached some screens and not others. Import it; never redeclare it. |
| `lib/trade-units.ts` | `formatQtyInTradeUnits`, `sellableTiers`, `costPerTradeUnit` | Packs and cartons, never pieces. `sellableTiers` reads `skus.sellable_units` — screens used to *synthesise* a Piece button, which invited a loose-diaper sale. Postgres has the twin: `qty_in_trade_units` / `unit_noun` (0143). |
| `lib/use-on-mount.ts` | `useOnMount(fn)` | Replaced 12 copies of `useEffect(() => { load() }, [])`. **Read its doc comment** — it is honest that it hides the lint rule rather than fixing it, which is why it is not called `useSafeEffect`. |
| `lib/palette.ts` | `PALETTES`, the pre-paint init script, swatches | Also maps a stored `"monochrome"` back to Sunrise. |
| `lib/offline-write.ts` / `offline-queue.ts` | `withOfflineFallback` → `enqueue` → `drainQueue` | The IndexedDB write queue. Verified end-to-end for the first time on 2026-08-10 (§12). |
| `lib/push.ts` | Every notification | One send path, admin fan-out, dedup, category gate. |
| `lib/mvt-date.ts` | Maldives time | Every date bucket. |
| `components/sales/cart/cart-math.ts` | `groupCartLines`, `cartonShortfall`, `lineQtyText`, … | Pure functions, no React. "1.666 cartons" and "7 bottles blue" both lived here; they are now testable in isolation. |

**New Sale was split out of a 4,044-line file on 2026-08-10.** If you are
looking for the composer it is **`components/sales/new-sale-sheet.tsx`**, not
`sales-list.tsx` (now 716 lines, and just the list). The Sosoft colour picker
is `mixed-carton-sheet.tsx`; the cart UI is `cart/cart-lines.tsx`.

---

## 3. Design system — READ `app/globals.css` BEFORE TOUCHING ANY UI

**This section is a MAP, not the record.** The record is `app/globals.css`
(1,837 lines, heavily commented with the reasoning and the date of each
decision) plus `skills.md` Seat 1, which carries the design laws with the
incident that created each one. Everything below is a pointer so a new session
knows what exists and does not damage it by accident. **Nothing here is
optional polish — it was built and tuned over many sessions on Ali's real
device.**

### 3a. Four palettes, each with light AND dark — and TWO materials

`[data-palette]` in `app/globals.css`:

| Palette | Material | Light | Dark |
|---|---|---|---|
| `sunrise` | glass | :360 / :371 | :375 / :665 |
| `aurora` | glass | :389 | :401 / :673 |
| `ember` | glass | :415 | :427 / :681 |
| `soft` | **carved** | :1989 | :2076 |

**`monochrome` was DELETED on 2026-08-10** (Ali: *"You can delete the
monochrome theme"*). `lib/palette.ts` maps any stored `"monochrome"` back to
Sunrise, so a phone that still had it selected does not land on a blank theme.
Do not resurrect it.

Switched from **Settings → `components/settings/palette-section.tsx`**, applied
pre-paint by the init script in **`lib/palette.ts`** (no flash of the wrong
theme). Glass fill/blur/radius tokens are **identical across the three glass
palettes** (:283) — only wallpaper, accent and status colours vary. A change to
the glass material therefore hits all three at once; a change to an accent must
be made in three places, plus Soft.

**Soft is not a colour variation — it is a different physics.** See §3f before
touching it, and before adding any surface anywhere.

Dark mode has its own name and its own tuning: **"Void & Vapor"** (:539) — a
neutral graphite glow fading to true OLED black, so translucent cards have real
depth to float above.

### 3b. Retina / Display P3 wide gamut (:1764)

Every iPhone since the 7 renders Display P3 — about **25% more colour volume
than sRGB**. Accent FILLS are re-expressed in `color(display-p3 …)` so buttons,
pills and active states get true system-colour vibrancy on Ali's screen, with
the sRGB hex above as the automatic fallback.

**Deliberately NOT converted:** the deepened `*-text` variants and
`--snm-brand-text`. Their WCAG ratios were verified in sRGB **on device, in
Maldivian daylight**. Fills only carry a 3:1 large-element bar; text does not.
**Do not "finish the job" by converting the text tokens.**

### 3c. The Liquid Glass master dial — one user scalar (:142)

`--glass-frost` (0–1, default 0.5, persisted as `snm-frost`) drives the whole
material Apple-style: 0 = clear glass, 1 = heavy frost. **0.5 reproduces the
hand-tuned look exactly** — both derived factors equal ×1 there, so the default
is a no-op. Four derived factors move fills, hairlines, specular rim and blur in
lockstep, which is what makes it read as one substance:

- `--frost-fill` ×0…×2 — fills reach TRUE zero at 0%
- `--frost-edge` ×0.85…×1.15 — edges never do: clear glass is still a glass
  *object*, defined by its hairline and rim light
- `--frost-b` — blur keeps a floor (×0.3); residual refraction over the moving
  wallpaper IS the glassmorphism read at the clear end
- the floating tab bar runs **10 points frostier** than the user's choice
  (Ali: it must stay visible at any transparency)

Every glass alpha in the file multiplies by one of these. **Add a new glass
surface without them and it will not respond to the dial.**

### 3d. What else is in there, by line

- **Apple HIG iOS type scale** (:75) — the `ios-*` classes, SF/Dynamic Type at
  Large. `.ios-page-title` is the one canonical page title (:1387).
- **Motion tokens** (:108) — one spring language app-wide
  (`--snm-spring`, `--snm-ease-out`). Never hardcode a bezier.
- **The scrim** (:119) — the ONE backdrop recipe for every modal/sheet/overlay.
- **Atmospheric depth** (:285 light, :616 dark) — the fixed `--app-bg` gradient
  painted by `body::before` (:907), which is what translucent surfaces reveal.
  **Neutral luminance only, no hue** — that is what keeps green/red/orange
  meaning money. Soft replaces the gradient with a flat base; see §3f.
- **Glass utility classes** (:958) — primary surface (cards, :968), secondary
  (modals/sheets, :984), tertiary (elevated dialogs, :993), flat (dividers, no
  blur for perf, :1002), sidebar (:1009), bottom nav (:1017), inputs (:1025).
- **Floating tab bar — iOS 26 Liquid Glass signature** (:1071). Uses
  `--tabbar-bg`/`--tabbar-border`, NOT the shared glass tokens, deliberately —
  and since 2026-08-10 `--tabbar-fg` / `--tabbar-accent` (:1732) for the
  labels, because the bar composites lighter than the page and failed contrast
  in every palette at once. Do not paint tab labels from `--muted-foreground`.
- **Concentric corner radius** (:1315) and **capsule controls** (:1324) —
  Apple's default button shape; `.glass` / `.glassProminent` buttons (:1327,
  :1346) mirror SwiftUI's `buttonStyle`.
- **Press physics** `.snm-pressable` (:1276), **tabular money** `.snm-num`
  (:1287), **accessible focus ring** (:1295), `.label-caps` (:1150),
  `.snm-input` (:1240) — 48px, the app's canonical field.
- **Three tokens that make a surface theme-aware** (:276–:280) —
  `--glass-blur-content` (never hardcode `blur(14px)` on a card),
  `--snm-float-shadow` and `--snm-thumb-shadow`. Added 2026-08-10 because the
  blur had been hand-typed into 22 components and shadows into 8 more, where
  no palette could reach them. `material.mjs` now fails the build over it.
- **Parallax drift** (:1509) — scroll-driven, compositor-thread only.
- **Native-app feel** (:876) — pinch-zoom and text selection blocked globally;
  native scroll indicators (:933). Rubber-band bounce stays ON.
- **Accessibility fallbacks that must survive refactors:**
  `prefers-reduced-motion` (:1852, plus :1560 and the Soft block),
  `prefers-reduced-transparency` (:1805 — opaque fills, no blur),
  `prefers-contrast: more` (:1829, and :2197 for Soft).

### 3e. The laws (full versions with case history in `skills.md` Seat 1)

- **The accent is graphite monochrome.** Ali rejected systemBlue three times and
  systemIndigo once. Interactive emphasis comes from WEIGHT, not hue — so
  green/red/orange are the only hues on screen and colour always means money.
  **The debate is settled; do not propose a new accent hue.**
- **Colour communicates affordance.** A static panel painted in accent colour is
  a bug.
- **Backdrop-blur on content cards is ON** (Ali overruled the old ban,
  2026-07-20). In-flow cards ~14px × frost dial; floating chrome 22–28px.
- **Sheets arrive, they don't appear** — `.snm-sheet-in` spring,
  `.snm-scrim-in` fade, transform/opacity only.
- **Contrast is measurable, not taste** — see the rule in `CLAUDE.md` and
  section 5k. It is now MEASURED on every PR by `contrast.mjs` (§12) rather
  than argued about; 72 checks, and the app passes all of them.

### 3f. Soft — the carved palette (2026-08-10, :1911)

**Soft is a different material, not a different colour scheme.** Read the
block header at `app/globals.css:1911` before changing anything in it; it is
the fullest statement of the reasoning and it is where the record lives.

The short version, because it governs how you write *any* new surface:

- **Soft UI and Liquid Glass are opposite physics.** Carved says "opaque, cut
  out of the page": one flat base, light shadow up-left, dark shadow
  down-right, zero transparency. Glass says "translucent, floating above the
  page". They cannot both describe one surface, so they are split **by role** —
  the same layering law the app already had, with one substitution:

  | Role | Material |
  |---|---|
  | In-flow content that sits ON the page — cards, rows, buttons, inputs, pills, steppers, toggles | **carved** (emboss/deboss, no blur) |
  | Chrome that floats ABOVE the page — tab bar, sheets, modals, topbar | **glass** (translucent, blurred) |

- **It works through a token bridge (:2032), not through class overrides.**
  Most screens in this app style *inline* from `--glass-*` tokens rather than
  through `.snm-card`. So Soft redefines the tokens themselves — `--glass-1`,
  `--glass-bg-1/2`, `--glass-fill-top/bottom` all become the flat base;
  `--glass-shadow` becomes the carve; `--glass-sheen`, `--glass-inner`,
  `--glass-specular` and `--glass-blur-content` go to `none`. **That is why a
  hardcoded `blur(14px)` or a hand-typed `box-shadow` breaks the theme:** it
  routes around the bridge, and no palette can reach it. `material.mjs` fails
  the build over exactly that.
- **Its three laws, because soft UI's known failure is contrast** (a control
  the same colour as its background, marked by a 1–2% shadow, measures ~1.1:1
  where WCAG 1.4.11 wants 3:1):
  1. **Text is never carved** — full `--foreground`; the muted token is
     deepened to `#585d69` / `#bcc1cb`.
  2. **A control whose state is not carried by TEXT carries it by a
     full-contrast FILL** — toggles, steppers, checkmarks. That is the
     reference image's own trick.
  3. **The fill is `--foreground`, never a hue** — colour still means money.
- **Dark Soft raises the page to `#212327`,** not OLED black: the emboss needs
  a mid-tone to push light off, and black has nothing to lighten.
- **It is cheaper than what it replaces** — two box-shadows per card instead
  of a per-card `backdrop-filter`.
- Its swatch in Settings is drawn from **literal** values, not the `--soft-*`
  tokens, since those only exist while Soft is the active palette. It carries
  `data-palette-swatch` so the material audit skips it.

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

## 5g. Ali's screenshots, 2026-08-05 — migrations 0136–0137

**The "OWES 776" contradiction (0136).** SO-2026-072 showed a red owing pill
in the Sales list while its own detail screen said the cash was collected AND
banked. Both were reading the database correctly — there were simply **two
places money could be recorded as received**: the `order_payments` ledger, and
`sales_orders.cash_collected_mvr` + `payment_status`, written directly by the
COD delivery flow with no ledger row. SO-2026-072 was the only order in the
database settled by the second route, and `balance_mvr` (added in 0132) only
reads the first.

This is the same defect class 0121 fixed for the unpaid *count*, which
`balance_mvr` then reintroduced for the *amount*. The durable fix was not
another special case in the balance formula — it was removing the second
place. `record_cod_collection(...)` now writes the ledger row, the
denormalised `cash_collected_mvr`, and the delivered status **in one
transaction**, and derives `payment_status` in Postgres. All three UI call
sites (sale-detail, my-deliveries, dispatch-view) go through it, including
offline via the queue's `rpc` action — so a driver can never sync a delivery
that loses its cash. **Never set `cash_collected_mvr` with a bare UPDATE
again.** Verified after: zero orders with COD cash but no ledger row, zero
settled orders showing a balance, zero unsettled orders showing zero.

**Packs and cartons, not pieces (0137).** Ali's standing rule, restated: the
vendor sells packs and cartons, he sells packs and cartons. Pieces stay in the
database for four reasons and appear on screen for none of them — the stock
ledger (which is what lets a part-opened carton exist), landed cost (a carton
divides to a piece before it meets a price), competitor comparison (rivals
sell 30s/34s/48s, so per-piece is the only comparable unit — Ali's own point),
and mixed cartons. Pack SIZE is kept because it identifies the variant. The
Sales composer and Sale Detail use the existing `lib/trade-units.ts`
`formatQtyInTradeUnits` — **that helper already existed from July; do not write
a second one.**

**Correction (0143): 0137 did NOT finish this job.** The paragraph above used
to claim the Sales card already read "1 carton (4 packs of 48)". It didn't —
`sales_order_item_summary` (0132) was still rendering "2 cartons (3×34 = 102
pcs)" under every card, and seven other places were still quoting pieces. The
rule was written down and then not enforced. Migration 0143 and the commit
"The app still sold diapers by the piece" close it, and this is what to check
before ever claiming it again:

- **The offer.** `skus.sellable_units` is the only input to any selling-unit
  picker — `sellableTiers()` in `lib/trade-units.ts`. New Sale *synthesised* a
  third "Piece" button for any pack-selling SKU; the add-item sheet and the
  returns sheet each hardcoded ctn/pk/pcs and ignored `sellable_units` outright,
  so a carton-only Sosoft could be sold by the pack in one screen and not the
  other. Evidence it was never real: of every sales line ever recorded, the 51
  with `uom='piece'` are Sosoft bottles in a mixed carton — **zero diapers.**
- **The words.** `qty_in_trade_units` / `unit_noun` in Postgres are the twins of
  `formatQtyInTradeUnits` / `containerLabel`. `sales_order_item_summary` and
  `get_sales_order_delete_impact` (which now returns `stock_restored_summary`)
  both go through them. Verified: 0 of 77 orders and 0 of 31 SKUs produce a
  string containing "pcs" or "piece".
- **The money.** Landed cost is stored per piece and *shown* per pack or carton
  (`costPerTradeUnit`). Shipment lines lead with the carton. Price Lists takes a
  pack price and a carton price and derives the per-piece column — that input is
  gone, along with the bug where entering only a carton price left Save dead.
- **Deliberate exceptions.** Market compares per piece (rivals sell 30s/34s/48s;
  Ali's own point). Stock Ops keeps a loose tier because a write-off is a ledger
  event and a torn pack is real — but named after the product ("btl"), not
  "pcs". Printed shelf labels keep "48 PCS / PACK": that is pack size.

**Shipment at a glance (0137).** `get_shipment_summary` rolls a shipment up
category → brand → model in CARTONS, with ordered and received as separate
columns so a short shipment is obvious. Answers "how many cases of Xtra Kering
did I order?" without hand-counting. On SH-2026-001: 96 cartons Xtra Kering,
22 Merries, 88 Sosoft across 5 colours.

**Green wash on the Sales cards.** The swipe-actions panel was mounted behind
every row at all times and revealed by translation. This app's cards are
**deliberately translucent**, so the green WhatsApp button showed straight
through all of them. Actions are now mounted only while a row is displaced. A
reveal-from-underneath pattern only works behind an opaque row — remember this
before adding another one.

**"Where is the simulation module?"** It shipped as "Costing", buried in the
More overflow, and Ali could not find it. Renamed to **Cost Simulator**.

---

## 5h. Unprompted expert sweep, 2026-08-05 — migration 0139 (0138 was deleted)

Ali: *"I am a complete layman. I want you to do 10 times better because you're
a full team of top experts. Act like it."* Fair. This section is what that
produced — findings nobody asked for.

**MARGIN WAS MEASURED AGAINST A PRICE HE NEVER CHARGES (0139, fixed).** The
biggest find. `v_skus.actual_margin_pct` divided landed cost by
`fixed_selling_price_mvr` — the per-PIECE price — but **no SKU sells by the
piece**; all 29 priced SKUs are `{pack,carton}`, `{carton}` or `{pack}`. The
pack/carton prices he actually charges were ignored. Wrong on **21 of 29
SKUs, in both directions**. The overstated half is the dangerous one:
Xtra Kering S showed 47.3% against a real 40.7% (728 pcs sold), Royal Soft
Boy M 31.8% vs 28.3% (384 pcs), Merries Good L 39.1% vs 35.7% (462 pcs).
Feeds Margin Watch, Reports, Price Book, Promo Advisor's floor and the Cost
Simulator — all inherited it. Per-ORDER margins were always correct
(`post_sale` snapshots the real transacted price); only the catalogue-level
figure was wrong. **`security_invoker=true` was restated and verified after
applying** — the 0125 lesson.

**THE XXXL "QUESTION" WAS NEVER A QUESTION — AND MY REASONING WAS WRONG.**
Ali settled it on 2026-08-05: *"MAMY-XTRA-XXXL-34x3 means it's 34pcs in a
pack. 3 packs in a carton. You should know that for all diapers."* **The SKU
code states the pack config. Read it.** The catalogue was always correct; no
SKU needed changing, and migration 0138 was deleted unapplied.

**Two mistakes worth not repeating:**

1. **Carton dimensions are REAL, not placeholders — I mis-stated this.** Ali
   corrected me: *"Cbm figures are not stand in. I use it to calculate actual
   cbm. It is critical for reliable [costing]... I filled most from a single
   measurement just for rough calculations."* CBM is meant to be true and it
   drives freight apportionment in `confirm_grn`; it is currently approximate
   because most SKUs were filled from one measurement. `cbm_per_carton` is a
   GENERATED column (L×W×H÷1e6) — only dimensions are entered. What remains
   true is the narrow point: it is accurate enough to split freight and not
   accurate enough to deduce what is inside a carton, which is where my
   original argument went wrong.

2. **The two XXXL SKUs are different products.** `MAMY-XTRA-XXXL-22x4` and
   `MAMY-XTRA-XXXL-34x3` are separate retail pack formats. Do not compare
   their per-piece economics and treat a difference as evidence of anything.

**Left as an observed fact, not a proposal:** the one batch on
`MAMY-XTRA-XXXL-34x3` records 128 pieces from 1 carton, and 128 is not
divisible by 34, so it cannot have come from the current (correct) config.
Recorded here for whoever next reconciles stock. **Do not act on it, and do
not raise it with Ali again unless he asks** — he has said the SKUs are right
and that is the end of it.

**NO BACKUPS — the single largest business risk.** The Supabase org is on the
**free plan**: no automatic backups, no point-in-time recovery. 75 orders,
57 customers, 179 stock movements and every financial record since 8 July
2026 sit in one 16 MB database with no restore button. A manual JSON export
was generated and sent to Ali. The real fix is the Pro plan (~USD 25/month).
This is not a technical preference; it is the cheapest insurance the business
can buy.

**Corrected a wrong note in this document.** Section 5c/earlier recorded that
the 07:00 low-stock cron might be silently failing (pg_net 5s timeout vs 5.6s
runtime). The edge-function logs disprove it: `daily-low-stock` returns 200 in
8.1s and `send-push` fires alongside it. It works. The worry was theoretical.

**A false alarm, checked and dropped.** 12 SKUs price a pack higher per piece
than a single — which looks like penalising bulk buyers, until you check
`sellable_units` and find **nothing sells as singles**. The per-piece price is
internal. Verified before reporting rather than after.

**What this list looked like mid-session, and where each item ended up.**
Kept because the reasoning is useful, corrected because leaving it as "still
open" would send a new chat off to redo settled work. **§7 is the live list.**

- ~~Apply migration 0138 (26 phantom XXXL pieces).~~ **Dropped.** The argument
  was built on CBM volume; Ali showed that reasoning was wrong. 0138 was
  deleted unapplied and there is no gap to fill. **Do not raise the
  XXXL-34x3 128-vs-102 discrepancy with him again.**
- ~~Island names fragmenting.~~ **Fixed** in migration 0141 —
  `normalise_island()` plus a trigger; 26 strings collapsed to 22. Only
  "Shaniya" and "Phase 2" were left, deliberately (§7a.3).
- ~~All 31 batches have no expiry date.~~ **Still true and now visible**:
  migration 0142 makes the morning briefing report 27 batches holding
  MVR 81,577 with no expiry, instead of a silent all-clear. Data entry, Ali's
  (§7a.2).
- **Upgrade Supabase to Pro for backups** — still open, still his call (§7a.1).
- **Skin Comfort L**: real margin 23.7% against a family that runs 24–31%,
  and the thinnest mover in the line. Nudging the pack from MVR 230 to 234
  puts it on the ladder. Still his call — a price is never changed for him.

---

## 5i. Below-cost guards — every money door, 2026-08-05 (migrations: none)

Ali's law, from skills.md: *"Losing money is a decision, never an accident. Any
path that adds a below-cost line pauses with the real numbers and an explicit
red 'Add at a loss'. One guard, every door (the quick-add-only guard was a
caught bug)."* It had been caught once and fixed in two places. Two more doors
were still open.

**Audited every path that can set a selling price. State after this session:**

| Door | Before | Now |
|---|---|---|
| New Sale — quick-add on a product card | guarded (July) | unchanged |
| New Sale — line editor | guarded (July) | unchanged |
| **Sale Detail — Add item / Edit item** | **nothing** | red panel + ConfirmSheet |
| **Price Lists — tier price entry** | colour hint only | red panel + ConfirmSheet |
| Market — "lock as fixed price" | refuses at `packPrice <= landedPerPack` | unchanged |
| Mixed-carton sheet | no typed price (carton rate ÷ N) | n/a |

**Why Sale Detail mattered most.** It is how a line gets onto an order that
already exists, and all it carried was a "below target margin" hint —
which needs `target_margin_pct`, and **30 of 31 active SKUs have none**. For
almost every product it said nothing at all and saved.

**Why Price Lists is arguably worse.** A below-cost line loses money once and
you see it on that order. A below-cost *tier price* loses money on every future
sale to that tier, silently, forever. It only tinted the margin red under 15% —
a colour, not a decision, with nothing separating "thin" from "underwater".

**Two implementation traps, both hit and fixed — check for these if you add a
guard to a fourth door:**
1. `onClick={save}` passes React's `MouseEvent` into a trailing
   `acceptLoss = false` parameter. It is truthy, so **every first tap skips the
   guard** and the whole thing is a silent no-op. Call `save()` explicitly.
2. A `ConfirmSheet` rendered as a child of a sheet's scrim inherits that scrim's
   `onClick={onClose}` — React portals bubble through the **React** tree, not
   the DOM tree — so tapping "Add at a loss" also dismisses the sheet under it.
   Render it as a sibling.

The bypass must travel as an **argument**, never as state read a render later.

**Cost basis is the unit actually sold** (migration 0139's lesson): cost per
carton for a carton line, cost per pack for a pack line. Never a per-piece cost
against a per-piece price nobody is charged.

No repair was needed — zero existing lines are below cost
(`line_total_mvr < landed_cost_per_piece_mvr * qty_pieces` returns nothing).
This is prevention.

## 5j. The simulator can cost a product he doesn't own, 2026-08-05 — migration 0144

Ali: *"What if I want to test a product I don't currently have? The only thing
I'll know is the fob price. But I want to simulate everything accurately before
I make a decision to introduce a new product."*

Every line in `simulate_landed_costs` was `join v_skus on v.id = sku_id`, so a
product with no SKU row could not be costed at all. That made it a **re-pricing**
tool, when the decision that actually costs money is the first-time buy.

**A line may now carry a `new_product` object instead of a `sku_id`.** Every
attribute resolves from either the catalogue row or the payload, and everything
downstream of that is the *identical* code path — the same CTEs, the same
apportionment, the same mirror of `confirm_grn`. There is deliberately no second
costing engine to drift.

**The CBM problem, and the honest answer.** A supplier quote gives the FOB and
the pack configuration. It almost never gives carton dimensions — and freight is
the only volume-driven cost, so CBM is the whole game. All 31 SKUs sit in just
**five** boxes (0.0160 to 0.0589), so `get_carton_size_reference` offers those
five real boxes ("same box as Xtra Kering L") instead of demanding a measurement.
Re-picking the box re-runs the simulation, which **is** the sensitivity test.
Worked example, a trial diaper at USD 10.20/ctn against a 30% target:

| Box | CBM | Landed/pack | Margin | Max FOB |
|---|---|---|---|---|
| Mama Lime | 0.0160 | 71.87 | 61.2% | USD 21.44 |
| Xtra Kering L | 0.0322 | 88.36 | 52.2% | USD 18.23 |
| Xtra Kering XXXL | 0.0350 | 90.98 | 50.8% | USD 17.72 |
| Skin Comfort L | 0.0544 | 107.97 | 41.6% | USD 14.40 |
| Royal Soft Boy L | 0.0589 | 111.67 | 39.6% | USD 13.68 |

Cost swings 55% across the range and the **verdict never changes** — even the
worst box clears the target. That is the point: it tells him when the
measurement matters and when it does not.

**`max_fob_per_carton_usd` is reverse (target) costing** — the standard FMCG
buying number. Given the price he thinks he can charge and the margin he wants,
the most he may pay per carton. Proven exact by round-trip: feeding USD 13.68
back in returns a margin of exactly 30.00% and 0.0% headroom. It is an identity
whenever duty is 0 — which is every category he trades (Diapers, Liquid
Detergent, Powder Detergent, Dishwashing are all 0%; only Tobacco is 200%) —
because freight and local charges do not move with FOB at all. With a non-zero
duty rate it is a close first pass, since the duty pot is itself apportioned by
FOB.

**Regression proof that 0144 changed nothing for existing SKUs:** replaying
SH-2026-001 still reproduces **30 of 31** locked GRN costs to 4 decimal places —
the exact figure migration 0140 recorded before this change. The one outlier is
the known XXXL-34x3 batch discrepancy already marked do-not-act.

Trial products ride in the same `p_lines` array as catalogue lines, on purpose:
adding one to a shared container **raises the freight for everything already in
it**, and only a joint simulation shows that.

## 5k. The contrast rule, with the numbers — 2026-08-05

Ali, on the new-product sheet, twice: *"The text is almost same color... What
are you doing differently for this specific card? All other cards in other
modules looks fine and legible."*

Fair question, and the answer is measurable rather than aesthetic.

A bottom sheet is `--glass-2` = **13% white** over the page gradient, and
`--muted-foreground` on it measured roughly **2.6:1** — under the 4.5:1
readable floor. (`--muted-foreground` was `#8e9192` at the time; it was
deepened on 2026-08-10 to `#63676f` light / `#aab0b8` dark after the same
token was caught failing on ordinary *cards* too — see §11b. Deeper, but
still not safe on a sheet, so the rule below is unchanged.) Every other screen uses the same token and looks fine because
its muted text is one short caption sitting *beside* real `--foreground`
content. A mostly-empty form has no such content: I had put the section
captions, the field names (as placeholders), four multi-line helper paragraphs
AND eight unselected pills all in the muted token, so 90% of the pixels were
grey-on-grey and there was nothing bright to anchor against.

**Note the trap:** the surfaces were fine. `--glass-bg-1` (9% white) fields on a
`--glass-2` (13%) sheet is the same stack the Shipments dialog uses. Chasing the
surfaces would have fixed nothing. It was the text.

Now enforced in CLAUDE.md:
- If it has to be read, it is `--foreground` (use `opacity: 0.7–0.85` for
  hierarchy). On a `--glass-2` sheet, prefer not to use `--muted-foreground` at
  all.
- **A field's NAME never lives in its placeholder** — placeholders are muted by
  definition, so on an empty form the name vanishes. Label above; placeholder
  carries the format only (`48`, not "Pieces per pack").
- An unselected pill carrying a **choice** is content: `--foreground` on
  `--glass-bg-1`, never muted-on-transparent.
- Prose is a contrast problem too. One short line per field.

## 5L. COMPLETE index of 2026-08-05 — every change, in order

Ali, at the end of that day: *"I can't remember all important stuff from this
chat because it's very long. It's your job. I want when I open a new chat for it
to know these."*

So: every merged PR of 2026-08-05, in order, with where the full reasoning
lives. The sections above go deep on the big ones; **this table is the
completeness check** — if something is not here, it did not happen that day.
`git log --format="%h %s" origin/main` is the authority if this ever disagrees.

| PR | What it did | Detail in |
|---|---|---|
| #2 | Storefront removed entirely; full money-math audit (0121–0126); Sales card redesign | §5, §5b |
| #3 | Stock loss on "Remove item" fixed before it ever happened (0134); destructive confirmations tiered — plain tap / hold-to-confirm / blocked, each showing what it destroys (0133) | §5e |
| #4 | Costing sandbox built (0135); pull-to-refresh on the main screens; left-swipe row actions; typography sweep (tabular money, HIG sizes) | §5f |
| #5 | "OWES 776" vs "cash deposited" contradiction fixed — COD cash now writes the payments ledger, `cash_collected_mvr` and delivered status in ONE transaction (0136); packs-and-cartons language; `get_shipment_summary` rolls a shipment up category→brand→model in CARTONS (0137) | §5g |
| #6 | **Margin was measured against a price he never charges.** `v_skus.actual_margin_pct` divided landed cost by the per-PIECE price; no SKU sells by the piece. Wrong on **21 of 29 SKUs** (0139) | §5h |
| #7 | Price Simulator was built, routable and **invisible** — the More sheet and the sidebar each kept their own hardcoded href list, so adding it to nav-config did nothing. Nav grouping is now DATA (`section` on each item) and both menus derive from it. Hard rule 8 | `components/layout/nav-config.ts` header |
| #8 → #10 | I claimed carton dimensions were nominal placeholders and must never be reasoned from. Ali corrected me: *"Cbm figures are not stand in. I use it to calculate actual cbm. It is critical."* #10 rewrote it as **real data with known error** — accurate enough to split freight, not to deduce carton contents | `CLAUDE.md` "Carton dimensions are REAL" |
| #9 | Simulator asked for IDR→MVR, a rate Ali never has. Now takes **USD→MVR and USD→IDR** like the real shipment form and derives the third. FOB accepted per pack or per carton (0140) | 0140 header |
| #11 | Simulator's price entry rewritten to **copy the Shipments line dialog** instead of inventing one — pill toggle, unit noun from the category, nothing pre-ticked | 0140 header |
| #12 | **Shared container modelling** added to the simulator (Ali: "very important") — freight share = total container freight × (my CBM ÷ capacity), so adding cartons RAISES the bill. Island names normalised: 26 strings → 22, `normalise_island()` + trigger (0141) | 0141 header |
| #13 | `get_morning_briefing` compared `timestamptz::date` to `CURRENT_DATE - 1` in a **UTC** session, so orders placed 00:00–05:00 Malé time landed on the wrong day. Also: `expiring_value_mvr` was always 0 because no batch has an expiry, which read as an all-clear — now reports **27 batches, MVR 81,577 with no expiry date** (0142) | 0142 header |
| #14 | **The app still sold diapers by the piece** in eight places (0143) | §5g correction |
| #15 | Handoff correction: 0137 had NOT finished the units job, despite the file claiming it had | §5g |
| #16 | Below-cost guard was missing from Sale Detail's Add/Edit item — 30 of 31 SKUs have no target margin, so it warned about nothing | §5i |
| #17 | Below-cost guard added to **Price Lists** — a bad tier price loses money on every future sale, silently | §5i |
| #18 | Handoff: the money-door audit table | §5i |
| #19 | Simulator can cost a **product not stocked yet**; reverse costing gives the max FOB per carton (0144) | §5j |
| #20 | New-product sheet rebuilt on the app's own patterns after Ali rejected it — L/W/H dimensions with derived CBM, unambiguous "price of ONE carton", units never hardcoded | `CLAUDE.md` pre-build gate |
| #21 | Same sheet: grey text on a grey sheet. Contrast rule with numbers | §5k |
| #22 | Handoff: design-system map + module map + "this is a map, not the record" | §2b, §3 |

**Migrations applied that day:** 0132–0137, 0139–0144. **There is no 0138** —
it was written (adjusting XXXL piece counts), then deleted because the argument
behind it was built on CBM volume and Ali showed it was wrong. Do not
resurrect it, and **do not raise the XXXL-34x3 128-vs-102 batch discrepancy
with Ali again** — recorded as do-not-act, do-not-raise.

**Process rules that came out of that day, all now in `CLAUDE.md`:**
the pre-build gate (name the existing screen before writing any UI), the
contrast rule with measured ratios, "never offer a selling unit the SKU doesn't
sell", "money is quoted in the unit sold", and "derived numbers are never
typed".

**One operational thing worth knowing:** a squash-merge to `main` twice failed
to trigger a Vercel production deploy that day. The branch preview built fine
and `main` was correct in git — the webhook was simply missed. An empty commit
re-fires it. **"Merged" and "live" can come apart; always verify the production
deployment reaches READY and that the `saynomore-beta.vercel.app` alias points
at it.**

## 6. Built up to 2026-08-04 (recent → older highlights)

*("this session" when written; kept as-is because the detail is still accurate.
For newer work see §9 (08-06), §11 (08-07 → 08-10) and §12.)*

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

## 7. What is left to do — start here in a new chat

**Current as of 2026-08-05, end of session — then amended where §11 (2026-08-07
→ 08-10) overtook it.** Everything above this line is done, applied live, and
deployed. Nothing is half-finished. **Where §7 and §11 disagree, §11 is newer.**

### 7a. Ali's, not mine — do not start these without his word

1. **Backup. — TOOLING BUILT 2026-08-10; the running of it is still his.**
   The Supabase project is on the **FREE plan**, and Supabase's own words are
   that backups "are not available for download for Free Plan projects" and
   that deleting a project removes them "irreversible". So `npm run backup`
   now exists (`scripts/backup.sh`), and **its restore has been tested, not
   assumed** — see §11. What is still open is a decision only Ali can make:
   run it on a schedule and keep the file **off** the Supabase account, or
   pay about **USD 25/month** for Pro and get daily backups plus no pausing.
   He has been told; do not keep raising it.
2. **Expiry dates.** 27 batches holding **MVR 81,577** have no expiry recorded,
   so the whole FEFO/expiry engine (built, tested, wired into the briefing) is
   dark. The dates are printed on the cartons — data entry, not code.
3. **Two ambiguous island names.** `"Shaniya"` looks like a person's name and
   `"Phase 2"` is ambiguous. Deliberately left rather than guessed. (Hulhumale
   Phase 1 / Phase 2 are kept separate on purpose — they are real, distinct
   delivery areas.)
4. **Delete the leftover Vercel project shell** from the removed web shop — see
   section 1. Careful to pick the leftover, NOT `saynomore`.
5. **Skin Comfort L pricing.** Real margin **23.7%** against a family that runs
   24–31%, and the thinnest mover in the line. Moving the pack from MVR 230 to
   234 puts it on the ladder. **A selling price is never changed for him** — the
   app watches and suggests; he decides.

On 2026-08-05 Ali said of items 1–3: *"Disregard these I will do it."* So do
not re-raise them; just do not assume they are done either.

### 7b. Offered and never answered — do NOT build unasked

- A **forwarder-billed CBM field**, so the freight-accuracy check becomes
  routine instead of manual. Offered; no answer. Leave it.

### 7c. Genuinely open engineering, in priority order

1. ~~**Competitor prices into the new-product simulator.**~~ **DONE 2026-08-06**
   — built category-scoped (a diaper trial can only ever be benchmarked
   against other diapers), plus a manual typed-in rival price flagged
   "TYPED IN". See §9.
2. **Improve CBM accuracy.** Only **five distinct carton sizes** cover all 31
   SKUs, and most were filled from a single measurement. On SH-2026-001 the top
   three sizes carry **85% of the freight**. A five-measurement job that
   improves every landed cost in the system. **Ali said 2026-08-06 he will do
   the measurements and apply them himself** — do not start this.
3. **Preventive duplicate-customer constraints.** Zero duplicates exist today,
   so this is pure prevention. A hard UNIQUE on phone is risky — families share
   numbers — so it needs thought, not a quick index.
4. **Extend swipe actions beyond Sales rows.** Low value; only if asked.
5. **Grow the pgTAP suite** (§10). Now **173 tests across 19 files**, up from
   41 — returns and tier pricing both got covered in between. The two that are
   still genuinely untested: **`write_off_stock`** and
   **`admin_force_void_grn`**. Both destroy stock, which is exactly the kind
   of function that should not be the untested one.
6. **The 43 remaining lint warnings** (§7e). **15 of them are not cleanup** —
   they are `setState` after an `await` inside a fetch, which is the ordinary
   client-fetch shape and only removable by changing how the app loads data.
   That is an architecture decision, not a tidy-up, and it needs Ali's word
   before anyone spends a session on it. The rest are one-line resets and
   dialog form-syncs; each needs the **open-two-records-in-a-row** proof used
   on `EditSkuDialog` before it is touched, because that is the bug this class
   of "fix" causes. Put `--max-warnings 0` in the lint script only when they
   reach zero — a threshold that is never met teaches people to ignore it.
7. **Two dashboard-only security settings.** Supabase → Authentication: enable
   leaked-password protection, and reduce the OTP / login-link expiry to under
   an hour. Neither can be done from a migration or the MCP; they are clicks in
   the dashboard. Everything else on the security board is already clean (§11).

### 7d. Deliberately deferred, with the reason

- **FEFO depletion** — the engine is FIFO. The switch is written but waits on
  real expiry coverage (see 7a.2). Turning it on now would sort by nulls.
- **Calendar seasonality in reorder** — needs multi-year history. The trend is
  deliberately upward-only today (never orders less than before).
- **Card payments** — allowed in the schema, waiting on a BML merchant account.
- **Price tiers** — the full price-list system is wired into order pricing but
  **zero price lists exist**, so every sale uses the standard price.

### 7e. Known, labelled, and NOT bugs

Do not "fix" these; they were decided:

- The cash forecast counts ongoing sales run-rate **and** current receivables,
  a small deliberate overlap that is labelled on screen rather than hidden.
- Revenue elsewhere (Reports, charts, dashboard) is **GROSS**. Returns and
  write-offs are itemised as their own P&L deduction lines rather than silently
  shrinking revenue.
- Supplier payments are timed to expected arrival — a visible assumption.
- `sales_orders.order_source` exists but is constrained to `'walk-in'`; it
  predates the removed web shop and is not a leftover of it.
- The `react-hooks/set-state-in-effect` eslint warnings — **43 today, down
  from 58** — are pre-existing and deliberately parked, not forgotten. See
  §7c.6 for what each group is and what clearing it would cost. **Do not
  blind-refactor money dialogs to clear them:** a dialog that syncs its form
  in an effect looks wrong and is often load-bearing, and the failure it
  causes (stale values when you open a second record straight after the
  first) does not show up until you open two in a row.

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

---

## 9. Built 2026-08-06 — Cost Simulator + the test suite

### 9a. Cost Simulator: competitor prices, and new products first

- **Category-scoped competitor prices.** The new-product sheet can now check a
  trial product's price against what rivals charge — but **only within the same
  category**. The first draft would have let a diaper trial be benchmarked
  against any tracked product's rival price, including a soft drink. Ali caught
  it. Category gating is the fix, and the incident is now a standing rule in
  `CLAUDE.md` (run every proposal through the expert council *before*
  presenting it, not just before building).
  New RPC `get_competitor_reference_prices(category_id, pcs_per_pack,
  packs_per_carton)` — migration 0145. Normalises every observation to
  per-piece (same maths as `get_competitor_price_gaps`) then converts to the
  **trial's own** pack/carton size, in Postgres.
- **A manual typed-in rival price**, for when nothing is logged yet. It is
  **never written to `competitor_prices`** — a trial product has no SKU row to
  attach it to, and saving it would misrepresent a guess as a verified Market
  observation elsewhere in the app. It stays scratch to the trial and is
  badged **"TYPED IN"**, visually distinct from a real logged price. Picking a
  logged peer and typing a price are mutually exclusive.
- **New products now lead the screen.** Ali: the simulator is mainly for
  costing what he does *not* stock yet, but the existing catalogue list came
  first. Swapped; the catalogue is reframed as the supporting step (it is
  there so freight/duty split against real cartons, like a real GRN).
- **Duty rate suggested from the picked category** (`product_categories.
  duty_rate_pct`), same "shown, tap to use, never auto-filled" pattern as the
  competitor price. A typed override still wins.
- **`get_competitor_price_gaps` fixed** (migration 0146) — it was never moved
  onto `v_competitor_prices_current` after migration 0102 introduced it, so
  the Price Gaps dashboard was comparing against the cheapest price a rival
  was **ever** logged at, not their current one. Zero live results changed
  (every variant has exactly one observation today); it closes the gap before
  a second price check makes it real.

### 9b. Vercel: no more preview builds

`vercel.json` carries an `ignoreCommand` that skips the build unless the ref is
`main`. Ali: *"I don't need preview unless I ask."* Only merges to `main` now
produce a deployment. Works for any future branch name.

---

## 10. The test suite — read this before changing any money/stock function

**173 pgTAP tests across 19 files run automatically on every PR touching
`supabase/`** (`.github/workflows/db-tests.yml`). Free: GitHub Actions replays
every migration onto a throwaway Postgres in Docker and runs the tests against
it. **Nothing ever touches production.** No Supabase branching, no
subscription.

Run them locally with `npx supabase start` then `npx supabase test db`.

| File | Tests | What it guards |
|---|---|---|
| `security_and_stock_rules.test.sql` | 10 | No SECURITY DEFINER function is anon-executable (all ~94 in one test); RLS on every money/stock table; `stock_signed_delta`'s sign convention |
| `confirm_grn.test.sql` | 5 | Zero-CBM block; GRN status flip; batch + `stock_movements` get the exact piece count |
| `post_sale_fifo.test.sql` | 11 | FIFO empties the older batch first; the true weighted cost snapshot; double-post guard; **an oversized sale leaves no orphan order**; offline-key replay is idempotent |
| `money_rules.test.sql` | 9 | Margin measured against the unit actually sold (0139); Maldives date buckets (0123/0126/0130); returns netted off the balance (0124); no SKU sells by the piece |
| `destructive_guards.test.sql` | 8 | A part-paid order cannot be deleted and **its payment survives** (0129); a delivered order cannot be deleted; deleting returns stock (0134); deletions are audit-logged |
| `tier_pricing.test.sql` | 13 | Price-list resolution, incl. what a sold-out product costs (0050-era) |
| `pricing_health.test.sql` | 13 | Margin Watch judges the unit actually sold, and never stays quiet about a loss |
| `mixed_carton.test.sql` · `mixed_carton_return.test.sql` | 11 · 5 | A mixed carton and a whole single-colour carton stay separate; part of a mixed carton can be returned |
| `customer_returns.test.sql` | 9 | A return puts stock back into the batches it came out of |
| `customer_credits.test.sql` | 9 | Money owed BACK to a customer is not invisible |
| `edit_order_line.test.sql` | 10 | Editing a confirmed line cannot break the ledger; whole trade units only (0156) |
| `cod_collection.test.sql` | 9 | COD cash cannot quietly exceed the order's worth |
| `line_source_godown.test.sql` · `picking_split_godown.test.sql` | 9 · 8 | A line can ship from a different godown than the rest of the order |
| `reorder_censored_demand.test.sql` | 8 | Demand measured over the days you could actually sell |
| `promo_advisor.test.sql` · `reprice.test.sql` | 8 · 9 | Clearance keeps a floor margin; reprice works when the shelf is empty |
| `customer_lapse.test.sql` | 9 | The at-risk rhythm signal |

`supabase/seed.sql` is the shared fixture — one catalogue chain, one godown,
one supplier, fixed UUIDs. Add to it rather than rebuilding a catalogue in
each test.

**Every test above was mutation-tested**: the rule it guards was deliberately
broken in a local database, the test was observed to fail with exactly the
wrong numbers, then the correct version was restored and reverified. A test
that has never been seen to fail is not yet a test.

### 10a. What building the suite uncovered

Three real findings, none of which were live production defects, all now fixed:

1. **The migration history could not rebuild the database from scratch.**
   Twelve files broke a from-empty replay — a function referencing a column a
   *previous* migration had dropped, ten `CREATE OR REPLACE`s that change a
   function's return columns (which Postgres refuses without a DROP first),
   and 14 RLS policies that no migration ever created. Every one traces to the
   same cause: **a change made directly against production outside any tracked
   migration file.** All 137 migrations now replay cleanly onto an empty
   Postgres. This closes a real disaster-recovery gap that is *separate* from
   the no-backups risk in §7a.1.
2. **Eight functions came back anon-executable on a clean replay** — because
   new/recreated functions pick up an implicit `PUBLIC` grant here, and
   `REVOKE ... FROM anon` alone does not remove it. **Verified against live
   production first: production has always been clean for all eight.** Fixed
   in the migration files with an explicit `REVOKE ... FROM PUBLIC`.
3. **`confirm_grn`'s own zero-CBM check is unreachable** — a table CHECK
   constraint on `shipment_lines.cbm_per_carton` rejects the row at insert
   time, so the function's own `RAISE` can never fire through the app's normal
   path. The rule *is* enforced, just one layer earlier than the migration
   header implies. Not a defect; worth knowing before "fixing" it.

**When you add a money or stock rule, add the test with it.** That is now the
cheapest part of the work, and it is the only thing that makes the next
session's changes safe.

---

## 11. COMPLETE index of 2026-08-07 → 08-10 — every change, in order

**This section is newer than §7. Where they disagree, this wins.**

Fifteen PRs, #64 → #78, each squash-merged to `main`, each deployed and each
verified READY with `saynomore-beta.vercel.app` pointing at it. Grouped by what
they were about, not by date, because that is how you will look for them.

### 11a. New Sale — the screen every recent bug lived in (#64–#68)

Every one of these came from Ali's screenshots. They are listed because the
*pattern* matters more than the individual fixes: all five were layout and
unit-clarity defects in one 4,000-line file, and none of them could have been
caught by a database test.

- **#64 Mixed carton is the default**, and "Add more" no longer needs scrolling.
- **#65 "Add more" moves to the footer**, where nothing scrolls. An add control
  that lives inside a scrolling list disappears exactly when it is needed.
- **#66 A full carton and a mixed carton stay apart in the cart.** They had been
  merging into one line, which is where "7 bottles blue" and
  "1.6666666666666667 cartons" came from.
- **#67 One "Add product" button**, and the step indicator stops scrolling away.
  Three footer buttons wrapped their labels onto two lines at 393pt, so "Back"
  moved into the step indicator, which is now **tappable backwards only** —
  you can return to a finished step, never skip to an unfinished one.
- **#68 A real tablet and a real desktop layout.** Before this the phone screen
  was stretched to 1512px. The order **total was literally unreachable** on
  desktop: a sticky rail clipped inside the page's single scroller. Fixed with
  a split pane at `lg:` and an independently scrolling order rail — **the
  sanctioned exception** to the one-scroll-container rule in `CLAUDE.md`,
  because a docked rail is a pane beside the page, not content inside it.

### 11b. Soft, and the contrast sweep (#69, #70)

- **#69 Soft: a fifth palette, and every theme now passes contrast.** The
  palette is documented in **§3f**; read that plus `globals.css:1911`.
- **#70 Soft is consistent app-wide, and Monochrome is gone.** Ali:
  *"I think it's not consistent app wide. You can delete the monochrome
  theme."* He was right, and the cause is worth remembering: **the blur had
  been hand-typed into 22 components and shadows into 8 more.** No palette can
  reach a hardcoded `blur(14px)`. Three tokens now own it —
  `--glass-blur-content`, `--snm-float-shadow`, `--snm-thumb-shadow` — and
  `material.mjs` fails the build if a new one appears.

**The contrast work is the part to read before touching a colour.** Everything
below was **measured on the rendered page**, compositing the real backdrop
through every translucent ancestor — not read off a token. Every one of these
was invisible in `globals.css`:

| What failed | Measured | Fix |
|---|---|---|
| Tab-bar labels, dark, **in all four shipped palettes** | 3.81:1 | `--tabbar-fg` / `--tabbar-accent`; the bar composites lighter than the page |
| The accent used as **text** | 2.77:1 | restored `--snm-brand-text` per palette |
| The accent as a **button fill** under white | 3.09:1 | deepened sunrise + aurora `--glass-accent` |
| `--muted-foreground` on **cards** (it passed on the page) | 2.81 / 3.59:1 | `#63676f` light, `#aab0b8` dark |
| Dashboard "Assign now" — white on light orange, **dark mode** | **1.9:1** | `--snm-on-fill: #14100a` in dark |
| "Confirmed" badge, Aurora / Ember | 4.48 / 3.96:1 | `--snm-info` → the text variant, not the fill |
| Soft's muted + error red on **nested** surfaces | 4.47 / 4.35:1 | `#585d69` / `#b01d1d` |

**The lesson, and it generalises:** a token's contrast is meaningless until you
know what is painted behind it. Tune against the **lightest surface the token
can land on** — a card inside a card — never against the page.

### 11c. The house — one card, one file per job (#71–#75)

- **#71 The screens check themselves now.** The browser audit gate — **§12**.
- **#72 One card, one place.** Nine files each declared their own local
  `const CARD`. Now `lib/surfaces.ts` (§2c).
- **#73 Break up the 4,044-line sales file.** The order list, the wizard, the
  cart, the cart maths, the Sosoft picker and the warehouse selects were one
  scope. Now six files; `cart-math.ts` is pure functions with no React, which
  is where the arithmetic bugs were. Nothing changed behaviourally — the
  journey audit was the proof of that, and it is why the split was safe to do
  at all.
- **#74, #75 Warnings: 58 → 43.** Killed 327 lines of dead dialogs; stopped
  two lists flashing after a save; named the loader pattern
  (`lib/use-on-mount.ts`). **Stopped deliberately at 43** — see §7c.6 for what
  the remaining ones are and why finishing them is an architecture decision
  rather than a cleanup.

### 11d. Things that had never once been verified (#76–#78)

Each of these covered a path that was *believed* to work and had never been
exercised. That is the category worth hunting for.

- **#76 The offline path.** `withOfflineFallback` → `enqueue` → `drainQueue`
  had been unverified since the day it was written, and an offline sync bug
  here once meant real cash was recorded and silently never saved. Now driven
  for real: network cut mid-sale, queued not lost, the screen says so, the
  queue drains on reconnect, the order exists. The same PR fixed audits that
  **passed on an empty database and failed on a used one** — two selectors
  were matching rows *behind* the sheet.
- **#77 There is no backup of this business. Here is one.** `npm run backup`
  → `scripts/backup.sh`. What building it taught, all three of which are traps:
  1. **`supabase db dump` defaults to SCHEMA ONLY.** It prints "Dumping
     schemas" and produces a perfectly valid file with every table definition
     and **not one row of business**. It restores cleanly and is empty. The
     script therefore dumps schema and data separately, and **verifies the
     ledger is present before claiming success** — that verification is the
     only reason the trap was caught.
  2. **`pg_dump` 16 against Postgres 17 refuses outright.** The Supabase CLI is
     preferred because it runs a matching version in a container.
  3. **The repo is PUBLIC.** A dump holds every customer, price and payment,
     so the script *refuses to write inside the repository*.
  **The restore was tested, not assumed:** 2 orders, 5 lines, 10 stock
  movements and 6 products came back whole. The ~57 errors were all Supabase
  platform schemas (auth/storage/realtime) that only exist inside a Supabase
  project; none touched business data.
- **#78 Cover receiving — the biggest money calculation in the app.** See §12.

### 11e. Security and performance — measured, not assumed

Both were checked properly for the first time. **Nothing needed fixing**, which
is worth recording so the next session does not re-run it for nothing:

- **RLS is on for all 33 `public` tables**, and every anon-facing SELECT policy
  requires `auth.uid() IS NOT NULL` or a role check.
- **Anonymous reads were actually attempted** against 10 tables with the live
  anon key — all refused, `42501 permission denied`. Empirical, not inferred.
- Supabase advisors: **0 errors**, 72 WARN, of which 68 are the benign
  `authenticated_security_definer_function_executable`.
- `keepalive()` is the one anon-executable SECURITY DEFINER function. It is
  `select now()` with `search_path ''`. Harmless, and deliberate.
- **Git history contains no production `service_role` key.** The only one
  present is Supabase's well-known **local demo** key, added for CI.
- Vercel runtime errors over 7 days: **none**.
- **`pg_net` was left in the `net` schema on purpose.** Its functions already
  live there and the pg_cron digest calls `net.http_post` schema-qualified;
  moving it would break the 07:00 low-stock digest to satisfy a lint.
- **Performance, first measurement** — throttled phone (4× CPU, ~1.6 Mbps,
  150 ms latency): first paint 644–796 ms, fully loaded 1.5–1.8 s, 79 KB, ~32
  requests, **no sequential query waterfalls** (21 files use `Promise.all`).
  **Caveat, stated plainly: measured against a 6-SKU fixture, not production
  data volumes.** Re-measure against real data before trusting it.

### 11f. Still Ali's to do, from this stretch

1. **Run `npm run backup` regularly, and keep the file off the Supabase
   account** — or move to Pro. §7a.1.
2. **The two dashboard-only auth settings.** §7c.7.
3. **Measure the five carton sizes with a tape measure.** Said before and it
   is still the highest-value non-code job on the board: every landed cost,
   margin and price warning rides on dimensions mostly filled in from one
   rough measurement, and the top three sizes carry **85% of the freight**.

---

## 11g. If CI "didn't run", the PR is probably CONFLICTED — 2026-08-11

Twice in one session a pull request showed **zero workflow runs**. Not failed,
not skipped — no run created at all, for either workflow, with both of them
`active` and the changed files plainly matching their `paths:` filters. The
first time it was written off as a GitHub hiccup and the runs were fired by
hand with `workflow_dispatch`. It happened again on the very next PR.

**The cause: `on: pull_request` workflows run against the MERGE ref
(`refs/pull/N/merge`). A conflicted PR has no merge ref, so GitHub never
creates the run.** The PR looks normal; the checks section is simply empty.

Confirm it in one call rather than guessing:

```
GET /repos/{owner}/{repo}/pulls/{n}   ->   "mergeable": false,
                                           "mergeable_state": "dirty"
```

**Why it kept happening here, and why it will happen to you too.** Everything
merges to `main` by SQUASH, and this project reuses one long-lived branch name.
After a squash-merge, `main` holds the work as a NEW commit while the branch
still carries the original — same content, different SHA. Push more work on top
and the next PR conflicts against content that is already merged. Nothing looks
wrong locally; `git diff origin/main HEAD` shows only the new work, because the
trees agree. It is purely a history-shape conflict.

**The fix is the workflow that is already written down: after a PR merges,
restart the branch from `main` and replay only the new commit.**

```bash
git fetch origin main
git log --oneline origin/main..HEAD          # what is unique
git diff --stat origin/main <merged-commit>  # empty = already in main, safe to drop
git checkout -B <branch> origin/main
git cherry-pick <new-commit>
git push --force-with-lease origin <branch>
```

The `git diff --stat` line is not optional — it is what makes the
`--force-with-lease` safe under hard rule 9, and it takes one second. An
ordinary `git merge origin/main` also works and needs no force, at the cost of
a merge commit and hand-resolving conflicts that are usually just two lines.

**Do not fire the runs by hand and move on.** `workflow_dispatch` runs against
the branch head, not the merge result, so it tells you the branch is fine while
saying nothing about whether it merges cleanly — and it leaves the PR
unmergeable anyway. Fix the conflict; the run appears on its own.

---

## 12. The browser audit gate — read this before changing any screen

**Five audits run on every PR touching `app/`, `components/`, `lib/`,
`scripts/audit/`, `supabase/fixtures/` or `package.json`**
(`.github/workflows/ui-checks.yml`). They are the peer of §10: that gate
guards the money, this one guards what a person sees.

**Why they exist.** The database half of this app has had 170+ tests for
months and has not produced an incident. The screens had nothing — **every UI
defect in August was found by Ali, on his phone, after it shipped.** He was
the only quality check the front end had. Same app, two halves, one difference.

They are plain `.mjs` scripts that exit `0` or `1` and print numbers, not a
test-runner. Run the lot locally with:

```bash
supabase start && npm run audit:seed && npm run build && npm run start
npm run audit:ui        # all five
```

| Audit | Checks | What it guards |
|---|---|---|
| `journey.mjs` | 36 | A real sale driven on **phone, tablet and desktop**: mixed and single-colour cartons stay separate; a part carton cannot be added; the cart shows a total; no footer button wraps; the page never scrolls sideways; the rail is desktop-only; the add control is never inside a scroller; **no piece count ever reaches the screen**; nothing throws |
| `grn.mjs` | 13 | Receiving a shipment through the real screen, then the money it produced — per-line landed cost, total conservation, forex locked, stock moved, and that it **refuses to receive twice** |
| `offline.mjs` | 6 | A sale recorded with the network cut is queued not lost, the screen says so, the queue drains, the order exists |
| `material.mjs` | 9 screens | Every in-flow surface actually wears the current theme — structurally, not aesthetically |
| `contrast.mjs` | 72 | 4 palettes × 2 schemes × 9 screens, measured on the **rendered** page |

**They are proven to fail.** Each was verified by putting its bug back — the
table is in `scripts/audit/README.md`. A check that has never been seen to
fail is not yet a check; it is a source of false confidence. Two further
mutation attempts were deliberately *not* caught, and that was correct: each
had a second fix covering it. Worth knowing before trusting a green run.

**The fixture** is `supabase/fixtures/ui_fixture.sql` — one idempotent `DO`
block with **fixed UUIDs and an early return**. Fixed, because the first
version minted fresh UUIDs each run, which meant a second run violated a
unique key and, worse, **would have doubled the stock**. `seed.mjs` creates the
auth user through the real signup endpoint, so `handle_new_user` gets
exercised too.

**`seed.mjs` and `grn.mjs` refuse a non-local database URL.** They delete and
insert stock to reset their fixture; against production that is real stock.
The guard parses `new URL(value).hostname` — an earlier regex version read
`postgres:postgres@127.0.0.1` as remote and blocked a local run.

### 12a. The most instructive failure in the whole gate

The GRN audit's expected figures came from a **UI code comment** stating that
duty is apportioned by rate-weighted FOB. The audit returned 1,826.76 where
1,656.83 was expected.

**Because the total still balanced at exactly 61,600, the money was provably
conserved and only the split was in doubt — so the right move was to read
`confirm_grn`, not to "fix" the app.** It weights duty by
`fob_total_mvr * duty_rate_pct` and **falls back to CBM share when the total
weight is zero**. Every category Ali actually trades — Diapers, Dishwashing,
Liquid and Powder Detergent — is at **0.00%** duty; only Tobacco carries a
rate, and he does not sell it. So in production the weighted branch never runs
and duty spreads by CBM like everything else.

**The app was right and the expectation was wrong.** The fixture now matches
the path the business is actually on, not the one the code merely permits.
Two general lessons, both cheap and both repeatable: **check conservation
before checking the split** — a total that still balances tells you the error
is in apportionment, not in the money; and **a code comment is not the
record** — the function is.

### 12b. Adding a check

Put it where it belongs. A money or stock rule belongs in
`supabase/tests/database/` (§10), not here — these are for what a person sees.
Prefer one clear assertion with a **number in its failure message** over a
screenshot comparison: Ali reads the failure, and "3.84:1, needs 4.5" tells
him something a diff image does not.
