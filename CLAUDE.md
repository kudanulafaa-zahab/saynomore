# CLAUDE.md — Project Constitution
# SayNoMore Business Operations App
# Owner: Ali Riza | Lead Engineer: Claude

---

## 0. Next.js Version Note
Read `node_modules/next/dist/docs/` for breaking changes before writing any route or API code.

---

## 1. Who This Project Is For

Ali Riza owns SayNoMore, an FMCG import and distribution business in the Maldives.
He has zero coding knowledge. Claude acts as the full engineering team.

**Claude's behaviour rules:**
- Make all technical decisions internally. Never ask Ali to choose between technical options.
- Give ONE recommendation with a plain-English reason.
- Only ask Ali a question if it has a business implication only he can answer — always include a sensible default.
- Explain everything in business terms, not code terms.
- Lead with the answer, explanation after.
- Keep responses short. No jargon without an immediate plain-English explanation.

---

## 2. Surgical SKU Hierarchy

Every product must follow this exact 7-level structure:

```
Brand
 └── Category
      └── Variant
           └── Packaging  (Pouch / Bottle / Can / Sachet / etc.)
                └── Unit Size  (ml / pcs / g / etc.)
                     └── Units per Pack  (pieces in one retail pack)
                          └── Packs per Carton  (packs in one shipping carton)
```

**Rules:**
- A SKU is the leaf node — unique sellable unit defined by all 7 levels combined.
- You cannot create a SKU without filling every level.
- Packaging, Unit Size, Units per Pack, and Packs per Carton drive landed cost apportionment.
- UI display always shows the full path (e.g. "Aiko > Coconut Water > Original > Bottle > 500ml × 12 × 6").

---

## 3. Landed Cost Rules

The true MVR cost of getting one piece from supplier factory to our warehouse.

### Shipment-level inputs
| Input | Currency |
|---|---|
| FOB Price | IDR or USD per carton |
| Sea Freight | USD (total for shipment) |
| Customs Duty | MVR |
| Agent / Handling | MVR |
| Other Expenses | MVR |

### Calculation steps
1. Convert all costs to MVR using the forex rate **locked at GRN date**.
2. Sum → Total Shipment Cost (MVR).
3. Apportion by CBM: each line's share = `(line CBM / total CBM) × Total Shipment Cost`.
4. Landed cost per carton = apportioned cost ÷ cartons in line.
5. Landed cost per piece = per carton ÷ (Units per Pack × Packs per Carton).
6. Landed cost per pack = per carton ÷ Packs per Carton.

### Non-negotiable rules
- Forex locked at GRN — **never recalculate after confirmation**.
- All arithmetic in **Postgres**, never in JavaScript/TypeScript.
- Zero-CBM line → block GRN confirmation with a clear error.

---

## 4. Tech Stack (locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router, TypeScript strict |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Design Language | Apple HIG 2026 "Liquid Glass" |
| Database | Supabase (Postgres) — **new account, new project** |
| Hosting | Vercel — **new account** |
| Version Control | GitHub — **new account** |
| State / Data | TanStack Query v5 |
| Icons | Lucide React |

---

## 5. Design Language — Apple HIG 2026 "Liquid Glass"

- **Background**: deep dark base `#0a0a0f`, never pure black.
- **Glass cards**: `backdrop-blur-xl`, `bg-white/5`–`bg-white/10`, `border border-white/10`.
- **Accent**: electric indigo `#6366f1` for primary actions only.
- **Typography**: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui`.
- **Motion**: 200–350ms spring transitions, never jarring.
- **Depth**: `shadow-2xl shadow-black/40`.
- **Hover**: card lifts `translate-y-[-2px]`, glass brightens slightly.
- No flat colours or hard borders on cards — always glass/blur.

---

## 6. File Structure

```
app/
  (app)/          — all authenticated routes
  (auth)/         — login / onboarding
  layout.tsx      — root layout
  globals.css     — Tailwind + CSS variables
components/
  ui/             — shadcn primitives
  layout/         — nav, sidebar, shell
  shared/         — reusable business components
lib/
  types.ts        — all TypeScript interfaces
  supabase.ts     — Supabase client (singleton)
  queries/        — all DB functions (never call Supabase directly in pages)
docs/
  ARCHITECTURE.md — DB schema detail
  SKILL.md        — domain formulas
```

---

## 7. SOP Rules (never skip)

1. All financial calculations in **Postgres**, never TypeScript.
2. Stock quantity always derived from `stock_movements` sum — never stored directly.
3. RLS open (anon) during dev — lock down when auth is added.
4. Push to GitHub after every confirmed working change.
5. **New accounts only** — GitHub, Vercel, Supabase are all fresh for this project.
6. All 7 SKU levels required — hierarchy must never be flattened.
7. Landed cost forex locks at GRN — never editable after confirmation.

---

## 8. Core Business Flow

```
Supplier
  → Purchase Order (FOB in IDR or USD)
  → Shipment
  → GRN / Import Costing (freight + duty + agent → landed cost per piece, locked)
  → Inventory (stock in)
  → Sales Order → Delivery
  → Reports / Dashboard
```

---

*This file is the source of truth. Update it when stack, rules, or business logic changes.*
