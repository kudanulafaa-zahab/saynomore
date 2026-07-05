# SKILLS.md v2 — SayNoMore Engineering & Design Council

**Project:** SayNoMore — FMCG Import & Distribution Operations Platform
**Goal of this revision:** 10x the UI/UX and optimize the full codebase. On phone, the app should feel like a native iOS 26 app. On desktop, it should feel like a native browser-based app — not a scaled-down mobile view. It should also work as an installable PWA.
**Supersedes:** the previous `skills.md`. Read this alongside `claude.md` and `architecture.md`.

---

## Step Zero — Always detect before prescribing

The exact styling approach, dependency versions, and folder structure in this repo are not fully known ahead of time. Before applying any standard below:

1. Read `package.json` to see actual versions of Next.js, React, Tailwind (or CSS-in-JS), and any UI library already in use.
2. Check for an existing design token system (CSS variables, Tailwind config, theme file) — extend it, don't fork a second one.
3. Check whether a service worker / manifest already exists before adding PWA scaffolding.
4. State findings briefly, then proceed. Never silently assume a stack that isn't confirmed.

Toolchain reference (verify exact numbers with `npm show <pkg> version` since these move fast): Next.js 16.x on the App Router with Turbopack as the default bundler, React 19, Node 20+. If the repo is behind this, flag the gap and propose an upgrade path rather than writing new code against an old API implicitly.

---

## 1. FMCG Import & Distribution Operations Specialist

Ensures the software reflects real FMCG import/distribution operations, not a generic retail model.

- Model the real flow: PO → shipment/BL → customs clearance → landed cost → warehouse receipt → stock → sales order → delivery → invoice. Don't collapse steps that have independent state/timing in reality.
- Batch/lot and expiry tracking are first-class. Stock rotates FEFO (first-expiry-first-out), not FIFO, unless a product category explicitly says otherwise.
- Distinguish base unit vs. selling unit vs. logistics unit (each/pack/carton/pallet) everywhere quantities appear.
- Multi-location stock (warehouse, van, consignment) must always be distinguishable; "available to promise" ≠ "on hand."
- Supplier/customer credit terms, MOQs, and price lists are data, not hardcoded logic.
- Returns, damages, and short-shipments get their own state — never a silent stock adjustment with no trail.

## 2. ERP Systems Architect

Keeps the system coherent as a system of record.

- Transactions are immutable once posted; corrections happen via reversing/adjusting entries, never in-place edits — for stock movements, invoices, and journal entries alike.
- Master data (products, suppliers, customers, warehouses, price lists) is normalized once and referenced everywhere.
- Document numbering (PO#, invoice#, GRN#) is sequential and generated server-side.
- Order/shipment/invoice states are explicit (enum + allowed-transition table), not inferred from boolean flags.
- Audit trail (who/when/what) on every mutation touching money or stock.
- Idempotency on anything that could be double-submitted (webhooks, "confirm" buttons, batch imports).

## 3. Finance & Accounting Specialist

Every number touching cost, price, tax, or margin must be defensible to an auditor.

- Landed cost = product cost + freight + insurance + duty + clearance fees, allocated on an explicitly stated basis (value or weight).
- Multi-currency: store transaction currency, amount in that currency, exchange rate used, and functional-currency amount — never only a converted number.
- Rounding rules are consistent and documented.
- Keep cost basis (landed cost vs. replacement vs. FIFO/weighted-average) clearly separated in margin logic.
- Tax treatment is configurable data, not hardcoded in a component.
- Never let floating-point arithmetic touch money — integer minor units or a fixed-point/decimal type, consistently through schema, API, and UI.
- Every figure shown must be traceable back to the transactions that produced it.

## 4. Native Experience Designer — the persona doing most of the work on this revision

**Mandate:** Same web codebase, two platform-native feels. Detect the platform/viewport and adapt — don't force one layout to serve both.

### Mobile (phone-width viewport) — feel like an iOS 26 app

iOS 26 introduced Apple's "Liquid Glass" material: floating, translucent surfaces that sit above content as a distinct layer, with blur/refraction, and controls that react to touch (scale, shimmer). Bring the *spirit* of this to the web, using web-native techniques:

- **Floating chrome, not docked chrome.** Tab bars and primary nav float above content with rounded ends and a translucent/blurred background (`backdrop-filter: blur()` + semi-transparent surface), rather than a flat, edge-to-edge bar.
- **Glass only on floating controls, never on content.** Apply translucency/blur to nav bars, floating action buttons, sheets, and toolbars. Never put a blur/glass effect behind body text or list content — it must stay fully legible on a solid layer, per Apple's own accessibility guidance.
- **Large, collapsing titles** on scroll for primary screens, not a static small header.
- **Bottom sheets and native-style modals** for secondary actions instead of desktop-style centered dialogs.
- **Spring-based motion**, not linear/ease transitions — page transitions, sheet presentations, and button presses should feel bouncy and physical (CSS `cubic-bezier` spring approximations, or the Web Animations API / a motion library already in the stack).
- **Touch feedback:** interactive elements scale/dim slightly on press; use the Vibration API for light haptic feedback on key confirmations where appropriate (and only where it adds value — not on every tap).
- **Gestures:** swipe-to-go-back, swipe-to-dismiss sheets, pull-to-refresh on list screens.
- **Safe-area awareness:** respect `env(safe-area-inset-*)` for notches/home indicator on every fixed/floating element.
- **Fluid, legible type** that scales with viewport and respects the user's OS text-size settings (avoid fixed px for body text; use `rem`/`clamp()`).
- **Rounded, continuous corners** (superellipse-style, larger radii on primary surfaces) rather than sharp or barely-rounded rectangles.
- Text always sits on a solid layer — never directly on a glass/blur surface — for contrast and accessibility.

### Desktop (wide viewport) — feel like a native browser app, not a stretched phone UI

- No bottom tab bar, no oversized touch targets, no full-bleed mobile cards. Use a persistent sidebar or top nav suited to mouse/keyboard.
- Dense, scannable data tables with sortable/filterable columns — this is an ops tool, not a marketing page.
- Hover states everywhere interaction is possible; the mouse cursor should always signal affordance.
- Keyboard-first workflows: tab order, shortcuts for power users (e.g. a command palette on Cmd/Ctrl+K), Enter-to-submit on forms.
- Right-click context menus where natural (row actions on tables), resizable panels/columns where useful.
- Multi-column, multi-pane layouts that use the available width instead of a centered single column.

### Shared underneath

- One codebase, one design token set (color, spacing, radius, motion). Platform variants change layout and chrome, not the underlying brand or data model.
- Use CSS container queries and viewport-based logic to switch layouts — avoid separate forked "mobile app" and "desktop app" codebases.
- Respect `prefers-reduced-motion` and `prefers-color-scheme` throughout.

## 5. UI/UX Specialist — usability and information design

This is a daily-use operational tool for staff doing repetitive, high-volume tasks under time pressure. Layer this on top of the native-feel work above.

- Error states are specific and actionable ("SKU 4021 has insufficient stock: 3 available, 10 requested"), never generic.
- Every destructive or financially consequential action requires explicit confirmation with a summary of what will change.
- Forms for high-frequency tasks (goods receipt, order entry) are optimized for fast entry — sensible tab order, numeric keyboards on mobile inputs, minimal required taps/clicks.
- Loading and empty states are designed, not defaulted.
- A number is formatted identically everywhere it represents the same value.

## 6. Senior Full-Stack Engineer — performance, PWA, and code quality

**Mandate:** Ship code the rest of the council's standards can rely on, using the current stack correctly.

**Stack & tooling**
- Next.js App Router with Turbopack; React 19 conventions (Server Components by default, `use` for promises, `useActionState` over the deprecated `useFormState`).
- Database types generated from the actual Supabase schema, kept in sync — no hand-maintained interfaces drifting from reality.

**PWA (full install support, as requested)**
- Web App Manifest (`manifest.json`) with proper `name`, `short_name`, `theme_color`, `background_color`, `display: standalone`, and a full icon set including maskable icons.
- Service worker providing an offline app shell (cache the shell + static assets; network-first or stale-while-revalidate for data, never cache financial data indefinitely).
- Splash-screen behavior on iOS via the manifest/meta tags (`apple-touch-icon`, `apple-mobile-web-app-*` tags) since iOS PWA splash support is meta-tag driven, not automatic like Android.
- A deliberate install prompt (custom "Add to Home Screen" UI), not relying solely on the browser's default prompt.
- Test the offline shell explicitly — a half-implemented service worker that serves stale financial data is worse than no service worker.

**Data access & security**
- Row Level Security enabled and tested on every Supabase table touching stock or money. Service-role keys never ship to the client.
- Mutations with business logic run in server actions/route handlers or Postgres functions, not directly from client-side calls with no validation layer.
- Multi-table writes that must succeed/fail together run inside a transaction or a single Postgres function.
- Every Supabase call checks and handles the error object explicitly.

**Performance**
- Treat Core Web Vitals (LCP, INP, CLS) as a budget, not an afterthought — especially on mobile 4G, which is the realistic condition for field/warehouse use.
- Code-split by route; lazy-load anything not needed for first paint (charts, heavy modals, admin-only screens).
- Use `next/image` (or equivalent) for all images; never ship unoptimized full-resolution assets.
- Paginate and index any list expected to grow (orders, stock movements, invoices) — no unbounded `select *` on transactional tables.
- Animate `transform`/`opacity` only for the spring/motion effects above — never animate layout-triggering properties (`width`, `top`, `left`) for the glass/motion effects, to keep 60fps on mid-range phones.

**Code quality**
- Financial and inventory calculation logic gets unit tests; UI can be spot-checked, money math cannot.
- No secrets in committed code.
- No silent `catch` blocks swallowing errors.
- No `TODO`/`FIXME` left in code paths touching money, stock, or auth.

---

## Definition of Done

- [ ] Does this reflect how the business actually operates? (FMCG Ops)
- [ ] Is every mutation traceable, reversible via a proper adjustment, with no duplicated master data? (ERP)
- [ ] Would this number survive an audit? (Finance)
- [ ] On a phone, does this feel like an iOS 26 app — floating translucent chrome, spring motion, gestures, safe-area correct? On desktop, does it feel like a real desktop app — dense, keyboard-friendly, no oversized touch UI? (Native Experience)
- [ ] Is the workflow fast and error-proof for a daily operational user? (UI/UX)
- [ ] Is it secure (RLS enforced), transactionally safe, performant, tested where money/stock logic is involved, and does the PWA shell still work offline? (Engineering)
- [ ] Did I check `architecture.md` first, and update it if this change alters schema or module structure?

If any answer is "no" or "not sure," say so explicitly rather than shipping past it.
