# AUDIT_BRIEF.md
## SayNoMore — Complete Project Reference Document
### Written for the next Claude chat session. This is the single source of truth.

---

## 1. PROJECT OVERVIEW

**SayNoMore** is a full-stack business operations app built for Ali Riza, an FMCG distributor based in the Maldives. The business imports consumer goods — primarily diapers (Mamypoko brand) and liquid detergent (SoSoft brand) — from Indonesian and other Asian suppliers, ships them by sea to Malé, and distributes them to shops and customers across Maldivian islands.

The core business problem this app solves: Ali was running his entire distribution operation across WhatsApp, paper notes, and spreadsheets. There was no single system tracking what stock he had, what it cost him, what it sold for, who owed him money, or how profitable each product was. The app replaces all of that with a purpose-built ERP that works like a native iOS app on mobile.

**Who uses it:**
- **Admin (Ali)** — full access: purchases, sales, pricing, reports, user management, financials
- **Manager** — same as admin minus user management and some destructive operations
- **Staff (delivery guy)** — restricted to the My Deliveries screen only; can mark orders as delivered, log cash collected
- **Viewer** — read-only access to all modules; no write capabilities

**What business problem it solves:**
1. Know exactly how much stock is on hand at every godown (warehouse), in real time
2. Know the exact landed cost (what each product actually cost including freight, forex, customs, duties) per piece, per pack, per carton
3. Know the actual gross margin on every sale, every product, every month
4. Track every purchase order from supplier to warehouse (GRN = Goods Received Note)
5. Run the full sales lifecycle from order capture to delivery to cash collection
6. See which products are running low and need reordering
7. Compare prices against competitors
8. Manage tiered pricing for different customer types (retail, wholesale, VIP, promo)
9. Print shipping labels for island deliveries with boat details and customer address
10. Manage the whole business from a phone, one-handed, like a native iOS app

---

## 2. ALL FEATURES — Every Screen and Workflow

### 2.1 Authentication
- Login page at `/login` — email + password with Supabase Auth
- Signup page at `/signup` — new account creation (typically admin creates accounts for staff via Settings)
- Password set page at `/auth/set-password` — used after admin-invited users set their password
- Auth callback at `/auth/callback` — handles Supabase OAuth/magic link redirects
- Middleware at `middleware.ts` gates all `(app)` routes — unauthenticated users are redirected to `/login`
- Role-based routing: staff users are hard-redirected to `/deliveries` and cannot access anything else; non-staff users on root `/` are redirected to `/dashboard`

### 2.2 Dashboard (`/dashboard`)
The main KPI view. Calls the `get_dashboard_metrics()` Postgres RPC which returns a single row with all metrics in one DB call. Metrics shown:
- Revenue today (MVR)
- Revenue this month (MVR)
- Revenue last month (MVR)
- Gross profit this month (MVR)
- Gross margin % this month
- Orders awaiting dispatch (confirmed but not yet out for delivery)
- Orders currently out for delivery (live count)
- Orders dispatched today
- Orders delivered today
- Overdue orders count (confirmed for more than 24 hours without dispatch)
- Low stock SKU count (SKUs with fewer than 7 days of inventory remaining)
- Total stock value MVR (all on-hand batches × landed cost)
- Shipments currently in transit
- Shipments arriving within 3 days
- Pending payments MVR (delivered orders where money not yet received)
- Pending payments count (number of such orders)
- COD undeposited MVR (cash in drivers' hands not yet banked)

### 2.3 Products / Catalogue (`/products`)
The master data module for the product hierarchy. Two-panel layout on desktop (tree on left, SKU detail panel on right). On mobile, the SKU detail slides up as a bottom sheet.

**SKU Hierarchy (7 levels, immutable):**
Brand → Category → Model → Variant → Packaging → Unit Size → (Units/Pack + Packs/Carton)

**Product tree:**
- Brands listed on the left
- Selecting a brand shows its models
- Selecting a model shows its variants
- Selecting a variant shows its SKUs
- SKU detail panel shows: internal code, supplier barcode, pack config (pcs/pack, packs/carton, pcs/carton), carton dimensions, CBM, active/inactive toggle, current stock level, landed cost (from most recent batch), selling prices at all three UoMs (piece, pack, carton), actual margin %

**New SKU Wizard (dialog):**
- Brand field (pick existing from dropdown or type new name)
- Category pills (pick existing; inline add new category; delete non-system categories — with confirmation sheet — instantly removes from UI via deletedCategoryIds Set)
- Model name (pick existing from dropdown or type new; model dropdown has × delete button per row wired to deleteModel() with confirm sheet)
- Variant attributes — driven by category (e.g. Diapers shows Size field; Liquid Detergent shows Format pill picker + Volume ml field)
- Format pill picker: options Bottle / Pouch / Pack / Box; clicking active pill deselects it (toggle); "Other…" free text input for custom formats
- Pack config: pcs per pack, packs per carton, auto-calculates pcs/carton total
- Carton dimensions (L × W × H cm), auto-calculates CBM
- Internal code (auto-generated from brand + model + variant + pack config; editable)
- Supplier barcode (optional)
- Customer Selling Price section:
  - Target margin % (auto-calculates selling price after each GRN)
  - Fixed selling price — toggle between "/ Bottle" (per trade unit) or "/ Carton" entry; system stores as per-piece in DB; live derivation preview shows per-bottle and per-carton computed from whichever you entered
  - Volume-break prices: optional per-pack and per-carton overrides
- Always stored per-piece in DB: `fixed_selling_price_mvr = entered_value / pcs_per_pack` (bottle mode) or `entered_value / (pcs_per_pack × packs_per_carton)` (carton mode)

**Categories:**
- Pre-seeded system categories: Diapers, Liquid Detergent, Powder Detergent (these cannot be deleted; Soap Bar and Other Pieces were demoted from system-protected in migration 0028)
- Each category defines: unit_uom (pcs/ml/g), cost_basis (piece/per_100ml/per_100g), variant_attributes (which fields appear in the New SKU wizard)
- Managers and admins can create additional non-system categories inline in the wizard

**SKU panel actions (role-gated):**
- Toggle active/inactive (hides from sales pickers when inactive)
- Edit SKU (opens EditSkuDialog)
- Cascade delete (CascadeDeleteDialog — admin only, warns if SKU is in use by transactions)

### 2.4 Shipments / Purchase Orders (`/shipments`)
Tracks the full lifecycle of an import shipment from purchase order to warehouse stock.

**Shipment status flow:** `draft → ordered → in_transit → arrived → grn_confirmed`

**Shipments list:**
- Filter by status chips
- New PO button (bottom sheet on mobile) — creates draft with reference number and optional supplier and PO number
- Each row shows: reference, status badge, supplier, expected arrival date, line count

**Shipment detail page (`/shipments/[id]`):**
- Header: reference, status, supplier, PO number, ETA, notes
- Forex rates panel: IDR→MVR, USD→MVR, IDR→USD (auto-derived from the other two; locked forever once GRN is confirmed — enforced by DB trigger `block_grn_rate_changes`)
- Freight costs panel: my_freight_share_usd, customs_duty_mvr, MPL charges MVR, agent fee MVR, last mile MVR, insurance MVR, other MVR
- Shared container flag: if ticked, the total container freight is shown and CBM apportionment splits it across lines by CBM share
- Product lines: each line has SKU, qty ordered (cartons), qty actually received (cartons), FOB price per carton, FOB currency, destination godown, CBM per carton (auto-filled from SKU dimensions)
- Live landed cost preview per line (estimated based on current freight inputs)
- GRN variance % shown per line (ordered vs received)
- Add product line button (bottom sheet) — fuzzy search across all SKUs
- Edit line inline
- GRN Confirm button: calls `confirm_grn()` Postgres RPC
  - Validates: forex rates present, all lines have CBM > 0, no lines with zero actual received qty
  - Computes: FOB uses qty_cartons_actual; CBM apportionment uses qty_cartons (you paid for the space); local costs apportioned by CBM share; landed_per_piece_mvr stored permanently on inventory_batches
  - Locks: forex rates locked forever at this point
  - Posts: inventory_batches rows and stock_movements rows (type = 'in')
- Admin void GRN: reverses the GRN if no stock from this shipment has been sold
- Admin force void GRN: nuclear option — removes shipment, batches, and all downstream sales orders; only for clearing test data

### 2.5 Sales (`/sales`)
The full sales order workflow.

**Sales list:**
- Filter chips: All / Draft / Confirmed / Out for Delivery / Delivered / Cancelled
- Channel filter chips: WhatsApp / Viber / Phone / Walk-in / etc.
- Payment status filter
- Each order card shows: order number, customer name, status badge, channel icon, line count, total MVR, payment status, delivery island

**New Sale wizard (full-screen overlay, 3 steps):**
- Step 1 — Customer: search existing customers or create new inline (name, phone, price tier); shows last 5 recent customers at top
- Step 2 — Products: scan/search SKUs, set qty and UoM (carton/pack/piece); prices pulled from tier price list if available, otherwise SKU defaults; mixed carton fill flag (sell pieces at carton rate)
- Step 3 — Confirm: review full order, add channel, payment method (COD / bank transfer / cash), delivery address line 1, delivery address line 2, island, boat delivery flag, notes; confirm creates the order as 'draft'

**Order confirmation:** Changes status to 'confirmed'; calls `post_sale()` Postgres RPC which deducts stock FIFO (oldest batch first) by creating 'out' stock_movements; blocks if insufficient stock

**Sales order detail page (`/sales/[id]`):**
- Order header: order number, status, customer, channel, created at
- Status timeline: shows which steps are complete
- Line items: each line shows SKU, UoM, qty, unit price, line total; mixed carton fill indicator
- Delivery info: address, island, boat flag
- Payment info: payment method, status, proof photo URL, cash collected, cash deposited
- Actions (role-gated): edit, confirm, advance status, cancel, print labels
- Assign driver, mark picked, mark out for delivery, mark delivered

**Label printing (`/sales/[id]/label/[lineId]`):**
- Per-line shipping label in A6 format (105mm × 148mm)
- PNG base image (brand-specific design) with SVG text overlay
- Diaper label: shows model, pcs/pack, packs/case, SIZE in large cell; delivery address 4 lines; boat details 4 lines; phone number
- Detergent/SoSoft label: shows variant, bottles/case, volume; same address/boat/phone block
- Boat details (name, jetty, time, date) entered on the label page before printing
- Print uses browser print dialog; label fits A6

### 2.6 Dispatch (`/dispatch`)
The dispatch coordination screen for managers. Shows all confirmed orders grouped by island, with assignment to drivers.

- Filter by island tabs
- Order cards show: customer name, address, items, total MVR, payment method
- Assign driver dropdown
- Mark as out for delivery button
- Confirm delivery sheet (slide-up on mobile) — records delivered_at timestamp

### 2.7 My Deliveries (`/deliveries`)
The staff-only delivery screen. Only visible to users with role = 'staff'. Shows the delivery guy their assigned orders for today.

- List of orders assigned to the logged-in driver
- Each card: customer name, address, items count, COD amount
- Status buttons: Mark Delivered / Log Cash Collected / Report Issue
- Cash collected entry (number input)
- No access to any other module — middleware hard-redirects staff to this page

### 2.8 Inventory (`/inventory`)
Stock levels across all godowns. Two views:

**Summary view:**
- One row per SKU showing total on-hand pieces, displayed as cartons + packs + loose pieces
- Reorder alert badges (critical = red, low = amber) based on DIR (Days Inventory Remaining) from `get_sku_reorder_alerts()` RPC
- Tap to expand: shows FIFO batch breakdown (which batch, received when, landed cost per piece, qty remaining)

**Godowns view (`/godowns`):**
- CRUD for godown (warehouse) locations
- Name, location, notes

**Manual adjustment:**
- Admin/manager can add or subtract stock with a note (goes into stock_movements as 'adjustment')

### 2.9 Customers (`/customers`)
Master data for customers.

- List with search
- Each customer: name, phone, island, price tier (retail/wholesale/vip/promo), preferred channel, notes, address line 1, address line 2
- Inline create/edit sheet
- Delete with confirmation

### 2.10 Suppliers (`/suppliers`)
Master data for suppliers.

- List with search
- Each supplier: name, country, invoice currency (IDR/USD/MVR/MYR/THB/CNY/EUR), contact name, email, phone, notes
- Inline create/edit sheet
- Delete with confirmation

### 2.11 Price Lists (`/pricelists`)
The tiered pricing system.

**Four tiers:** retail / wholesale / vip / promo
Each tier can have a named price list with an effective date. The most recent price list on or before today for a given tier is the active one.

**Price list workflow:**
- Create new price list for a tier (name, effective date)
- Add items: pick SKU, enter price per piece / pack / carton, or enter one and derive the others
- Price list drives the selling price shown in the sales wizard for customers on that tier
- Margin % is recorded at the time of entry for audit purposes

**Price lookup hierarchy (Postgres RPC `get_tier_price_for_sku`):**
1. Active price list item for the customer's tier (most recent effective date ≤ today)
2. SKU's fixed_selling_price_mvr / fixed_price_per_pack_mvr / fixed_price_per_carton_mvr
3. Margin formula: landed / (1 - margin%)
4. NULL (no price configured)

### 2.12 Financials (`/financials`)
Financial overview screen for the owner.

- Monthly revenue bar chart (last 6 months) from `get_monthly_revenue()` RPC
- P&L waterfall: revenue → COGS → gross profit → opex → net
- Gross profit by brand breakdown
- Month-over-month comparison
- COD reconciliation: shows by driver what was expected vs collected vs deposited
- Marketing spend / opex tracking

### 2.13 Reports (`/reports`)
SKU-level performance report from `get_reports_data(from, to)` RPC.

- Date range picker (preset chips: last 7d / 30d / 90d / this month / custom)
- One row per SKU: brand, model, variant, total qty sold, total revenue, avg unit price, landed cost per piece, total landed cost, gross margin %, current stock pieces, days of stock remaining
- Sort by any column
- Export-ready table layout
- Dead stock visible (SKUs with sales = 0 in period)

### 2.14 Expenses / Marketing Spend (`/expenses`)
Tracks marketing and operational expenses.

- Log entries: channel (WhatsApp ads / Instagram / TikTok / Facebook / Google / print / other), campaign name, amount MVR, start date, end date, linked SKUs (optional)
- List with filter by channel and date range
- Total spend summary
- Used in the financials opex calculation

### 2.15 Competitors (`/competitors`)
Competitor price intelligence.

- Add competitors by name
- Log competitor prices: pick competitor, pick SKU variant, enter price, select basis (per piece / per pack / per carton), enter their pcs/pack if different from ours, observed date, notes
- View: shows per-piece price normalized for comparison
- Live preview of our price vs their price per piece

### 2.16 Settings (`/settings`)
Admin/manager only (staff cannot access, viewer can read).

**Users tab:**
- List all users (calls `/api/admin/list-users` edge function)
- Invite new user: email, full name, role, temporary password (calls `/api/admin/invite-user` — uses Supabase Admin API; user is created and can log in immediately with the temp password)
- Edit user name and role
- Delete user (calls `/api/admin/delete-user`)
- Set password for existing user (calls `/api/admin/set-invited-password`)

**Profile tab:**
- Change own name
- Change own password
- Sign out

### 2.17 Labels (print flow)
Accessible from sales order detail page. Route: `/sales/[id]/label/[lineId]`

- Two label templates:
  - `DiaperTemplate` — for Mamypoko Diaper Pants (has SIZE cell in top-right)
  - `DetergentTemplate` — for SoSoft liquid detergent (no SIZE cell; product cell spans full width)
- Both templates: PNG base image + SVG text overlay on top
- PNG dimensions: 1240 × 1748 px (A6 @ 300 DPI)
- SVG viewBox: `0 0 1240 1748` stretched to fill `105mm × 148mm`
- Text fields overlaid: variant/model, pack config, delivery name, address line 1, address line 2, island, boat name, jetty, time, date, phone
- Coordinates measured via browser canvas pixel sampling (not guessed) — see diaper-template.tsx and detergent-template.tsx for exact x/y values
- Boat details entered on the label page itself before printing

---

## 3. TECH STACK

**Framework:** Next.js 16.2.4 (App Router)
**Language:** TypeScript 5, strict mode
**UI Library:** React 19.2.4
**Styling:** Tailwind CSS v4 (not v3 — uses `@import "tailwindcss"` not `tailwind.config.js`)
**Component Library:** shadcn/ui (using @base-ui/react under the hood, not Radix — important distinction)
**Database & Auth:** Supabase (Postgres 15 + Supabase Auth + Row Level Security)
**Supabase client packages:** @supabase/ssr ^0.10.2, @supabase/supabase-js ^2.105.3
**Icons:** lucide-react ^1.14.0
**Toast notifications:** sonner ^2.0.7
**Themes:** next-themes ^0.4.6 (light/dark/auto)
**CSS animation:** tw-animate-css ^1.4.0
**Utility:** clsx, tailwind-merge, class-variance-authority
**QR codes:** qrcode ^1.5.4 (available but not heavily used yet)
**Hosting:** Vercel
**Font:** Plus Jakarta Sans (loaded via Next.js font system)
**No test suite** — no Jest, Vitest, Playwright configured yet

**Key architectural rule:** All DB queries go through `lib/queries/<domain>.ts`. Pages never call Supabase directly. Financial arithmetic never happens in TypeScript — always in Postgres.

---

## 4. PROJECT FOLDER

**Full path on this Windows 11 computer:**
```
C:\Users\futurehomes\Desktop\Claude APP\saynomore-ali
```

**Key subdirectories:**
```
C:\Users\futurehomes\Desktop\Claude APP\saynomore-ali\
├── app\                        Next.js App Router pages
│   ├── (app)\                  All authenticated routes (gated by middleware)
│   │   ├── layout.tsx          App shell: Sidebar + Topbar + BottomNav
│   │   ├── dashboard\
│   │   ├── products\
│   │   ├── shipments\
│   │   ├── sales\
│   │   ├── dispatch\
│   │   ├── deliveries\
│   │   ├── inventory\
│   │   ├── customers\
│   │   ├── suppliers\
│   │   ├── godowns\
│   │   ├── pricelists\
│   │   ├── financials\
│   │   ├── reports\
│   │   ├── expenses\
│   │   ├── competitors\
│   │   └── settings\
│   ├── api\admin\              Admin API routes (service role)
│   ├── auth\                   Auth callback + debug + set-password
│   ├── login\
│   ├── signup\
│   ├── layout.tsx              Root layout (fonts, theme provider, Toaster)
│   └── globals.css             All CSS variables, Tailwind config, glass utilities
├── components\
│   ├── layout\                 Sidebar, Topbar, BottomNav, ThemeToggle
│   ├── products\               products-explorer.tsx, edit-dialogs.tsx, etc.
│   ├── sales\                  sales-list.tsx, sale-detail.tsx, dispatch-view.tsx, my-deliveries.tsx
│   ├── shipments\              shipments-list.tsx, shipment-detail.tsx
│   ├── labels\                 diaper-template.tsx, detergent-template.tsx, label-page-client.tsx
│   ├── masters\                customers-manager.tsx, suppliers-manager.tsx, godowns-manager.tsx, users-manager.tsx
│   ├── inventory\              inventory-view.tsx, godowns-view.tsx
│   ├── finance\                price-lists-view.tsx
│   ├── financials\             financials-view.tsx
│   ├── reports\                reports-view.tsx
│   ├── expenses\               expenses-view.tsx
│   ├── competitors\            competitors-view.tsx
│   └── ui\                     shadcn components (dialog.tsx, confirm-sheet.tsx, button.tsx, etc.)
├── lib\
│   ├── queries\                One file per domain — all DB calls live here
│   │   ├── products.ts
│   │   ├── sales.ts
│   │   ├── shipments.ts
│   │   ├── inventory.ts
│   │   ├── masters.ts
│   │   ├── pricelists.ts
│   │   ├── labels.ts
│   │   ├── reports.ts
│   │   ├── expenses.ts
│   │   └── competitors.ts
│   ├── supabase.ts             Browser client (client components)
│   ├── supabase-server.ts      Server client (server components + API routes)
│   ├── supabase-admin.ts       Service role client (admin API routes only)
│   ├── types.ts
│   └── utils.ts
├── supabase\migrations\        29 migrations (0001–0029)
├── public\                     Static assets
│   ├── diaper-label-design.png     A6 PNG base for diaper labels (1240×1748px)
│   └── sosoft-label-design.png     A6 PNG base for SoSoft labels (1240×1748px)
├── middleware.ts               Route guard + role-based redirect
├── .env.local                  Environment variables (never committed)
└── CLAUDE.md                   Project rules for Claude Code
```

---

## 5. GITHUB

**Repository name:** saynomore
**GitHub username:** kudanulafaa-zahab
**Repository URL:** https://github.com/kudanulafaa-zahab/saynomore
**Branch:** main
**Commit practice:** Push after every confirmed working change (hard rule)

---

## 6. SUPABASE

**Project reference ID:** smhdwkrmiytvpsgqezsl
**Supabase project URL:** https://smhdwkrmiytvpsgqezsl.supabase.co
**Project name:** SayNoMore (Ali's instance)

### Database Tables

**user_profiles**
- id (UUID, FK → auth.users)
- full_name, role (admin/manager/staff/viewer), phone, created_at, updated_at
- RLS: read = authenticated; write = admin only via API routes

**brands**
- id, name, notes, created_at, updated_at
- RLS: read = authenticated; write = admin/manager

**product_categories**
- id, name, description, unit_uom (pcs/ml/g), cost_basis (piece/per_100ml/per_100g), variant_attributes (JSONB array of attr keys), sort_order, is_system (boolean — system categories cannot be deleted), created_at, updated_at
- Pre-seeded: Diapers, Liquid Detergent, Powder Detergent (is_system=true)

**product_models**
- id, brand_id (FK → brands), category_id (FK → product_categories), name, hs_code, duty_rate_pct, notes, created_at, updated_at

**variants**
- id, model_id (FK → product_models), attributes (JSONB — e.g. {"size": "M", "volume_ml": 700}), display_name, created_at, updated_at

**skus**
- id, variant_id (FK → variants), internal_code (unique), supplier_barcode, pcs_per_pack, packs_per_carton, carton_length_cm, carton_width_cm, carton_height_cm, carton_weight_kg, cbm_per_carton (computed via trigger), is_active, notes
- Pricing columns: target_margin_pct, fixed_selling_price_mvr (stored per-piece), fixed_price_per_pack_mvr, fixed_price_per_carton_mvr
- created_at, updated_at

**suppliers**
- id, name, country, invoice_currency (IDR/USD/MVR/MYR/THB/CNY/EUR), contact_name, contact_email, contact_phone, notes, created_at

**customers**
- id, name, phone, island, address_line1, address_line2, preferred_channel, price_tier (retail/wholesale/vip/promo), notes, created_at, updated_at

**godowns**
- id, name, location, notes, created_at, updated_at

**shipments**
- id, reference (unique), supplier_id (FK → suppliers), status (draft/ordered/in_transit/arrived/grn_confirmed), supplier_po_number, expected_arrival_date
- Forex: rate_idr_to_mvr, rate_usd_to_mvr, rate_idr_to_usd (auto-derived; locked after GRN by trigger)
- shared_container (boolean), total_container_freight_usd, my_freight_share_usd, freight_share_notes
- Cost fields: customs_duty_mvr, mpl_charges_mvr, agent_fee_mvr, last_mile_mvr, insurance_mvr, other_mvr
- Timestamps: ordered_at, arrived_at, grn_confirmed_at, grn_confirmed_by, created_at, updated_at

**shipment_lines**
- id, shipment_id (FK → shipments), sku_id (FK → skus), qty_cartons, qty_cartons_actual, cbm_per_carton, fob_per_carton, fob_currency
- destination_godown_id (FK → godowns)
- Computed at GRN: fob_total_mvr, apportioned_freight_mvr, apportioned_local_mvr, landed_total_mvr, landed_per_carton_mvr, landed_per_pack_mvr, landed_per_piece_mvr, landed_per_unit_mvr, estimated_landed_per_piece_mvr, grn_variance_pct

**inventory_batches**
- id, shipment_id, shipment_line_id (FK → shipment_lines), sku_id, godown_id, received_at, qty_pieces_received, landed_per_piece_mvr (locked forever at GRN), created_at

**stock_movements**
- id, sku_id, godown_id, batch_id (FK → inventory_batches, nullable for adjustments), movement_type (in/out/transfer_in/transfer_out/adjustment/return_in/damage_out), qty_pieces (signed: positive = add, negative = remove), source_type (shipment/sales_order/adjustment), source_id, notes, created_by, created_at
- Stock quantity for a SKU+godown = SUM(qty_pieces) WHERE movement_type and sign rules applied — NEVER stored directly

**sales_orders**
- id, order_number (unique), customer_id (FK → customers), status (draft/confirmed/picked/out_for_delivery/delivered/cancelled)
- channel (whatsapp/viber/messenger/instagram/tiktok/facebook/walkin/phone/other)
- payment_status (pending/partial/paid/cod/deposited), payment_method, payment_proof_url
- source_godown_id (FK → godowns), delivery_address_line1, delivery_address_line2, delivery_island, delivery_to_boat (boolean)
- assigned_driver_id (FK → auth.users), picked_at, delivered_at, cash_collected_mvr, cash_deposited_at
- notes, created_by, created_at, updated_at

**sales_order_lines**
- id, order_id (FK → sales_orders), sku_id (FK → skus), uom (carton/pack/piece), qty, qty_pieces, unit_price_mvr, line_total_mvr, is_mixed_carton_fill (boolean — piece sold at carton rate), notes

**price_lists**
- id, name, tier (retail/wholesale/vip/promo), effective_from (date), notes, created_by, created_at
- Unique constraint: (tier, effective_from) — one list per tier per day

**price_list_items**
- id, price_list_id (FK → price_lists), sku_id (FK → skus), price_per_piece_mvr, price_per_pack_mvr, price_per_carton_mvr, margin_pct (recorded at entry for audit), created_at
- Unique constraint: (price_list_id, sku_id)

**competitors**
- id, name, notes, created_at, updated_at

**competitor_prices**
- id, competitor_id (FK → competitors), variant_id (FK → variants), price_mvr, price_basis (per_piece/per_pack/per_carton), their_pcs_per_pack (nullable — if they use different pack sizes), observed_date, notes, created_at, updated_at

**marketing_spend**
- id, channel (whatsapp/instagram/tiktok/facebook/google/print/other), campaign_name, amount_mvr, start_date, end_date, notes, created_by, created_at, updated_at

**marketing_spend_skus**
- id, spend_id (FK → marketing_spend), sku_id (FK → skus) — links a spend entry to specific SKUs

**audit_log**
- id, user_id, action, table_name, record_id, old_data (JSONB), new_data (JSONB), created_at
- Append-only — RLS blocks UPDATE and DELETE on this table

### Database Views
- **v_skus** — flat view joining all hierarchy levels; computes selling prices dynamically (latest landed batch → margin formula or fixed price); includes pcs_per_carton, full_path, landed_per_piece_mvr, selling_price_per_piece/pack/carton_mvr, actual_margin_pct
- **v_stock_levels** — one row per (sku_id, godown_id); SUM(qty_pieces) from stock_movements
- **v_batch_stock** — one row per inventory_batch; shows qty_pieces_remaining = batch qty minus all 'out' movements against that batch (FIFO reference)

### Postgres Functions (RPCs)
- `confirm_grn(p_shipment_id)` — the core GRN function; computes and locks landed costs; posts stock
- `post_sale(p_order_id)` — FIFO stock deduction on order confirmation; writes stock_movements 'out' rows
- `get_dashboard_metrics()` — all KPIs in one call
- `get_monthly_revenue(p_months)` — last N months revenue + opex by month
- `get_reports_data(p_from, p_to)` — SKU performance report; returns total_landed_cost_mvr computed in Postgres (not TypeScript)
- `get_sku_reorder_alerts()` — DIR-based reorder alerts per SKU
- `get_cod_reconciliation(p_date)` — COD cash reconciliation per driver per date
- `get_cod_orders_for_driver(driver_id, date)` — driver-specific COD view
- `get_tier_price_for_sku(sku_id, tier)` — active price list price or fallback
- `get_tier_prices_for_skus(sku_ids[], tier)` — batch version for sales wizard
- `admin_delete_brand_cascade(p_brand_id)` — admin-only; walks tree down; blocks if any SKU in use
- `admin_delete_model_cascade(p_model_id)` — same pattern
- `admin_delete_variant_cascade(p_variant_id)` — same pattern
- `admin_delete_sku(p_sku_id)` — same pattern
- `admin_void_grn(p_shipment_id)` — reverses GRN if no stock sold
- `admin_force_void_grn(p_shipment_id)` — nuclear: removes everything including downstream sales
- `skus_in_use(p_sku_ids[])` — helper: checks if any SKU in array has transactions
- `block_grn_rate_changes()` — trigger function: prevents forex rate changes after GRN
- `current_user_role()` — returns role of current auth.uid()
- `is_admin()`, `is_admin_or_manager()` — boolean helpers used in RLS policies
- `set_updated_at()` — trigger function to auto-update updated_at columns

### How the App Connects to Supabase
Three clients:
1. `lib/supabase.ts` — `createBrowserClient(url, anon_key)` — used in all "use client" components
2. `lib/supabase-server.ts` — `createServerClient(url, anon_key, {cookies})` — used in server components and API route caller verification
3. `lib/supabase-admin.ts` — `createClient(url, service_role_key)` — used ONLY in `app/api/admin/*` routes; bypasses RLS

---

## 7. VERCEL

**Live URL:** https://saynomore-beta.vercel.app
**Deployment:** Automatic from GitHub main branch via Vercel Git integration
**Environment variables set in Vercel:**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Build command: `npm run build` (standard Next.js)
No custom build scripts or Dockerfile.

---

## 8. ENVIRONMENT & CONFIG

**`.env.local`** (never committed, lives only on the dev machine and Vercel):
```
NEXT_PUBLIC_SUPABASE_URL=https://smhdwkrmiytvpsgqezsl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**`.env.local.example`** (committed — template for new devs):
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...your-anon-key...
```

**`next.config.ts`** — Empty config, no special overrides.

**`middleware.ts`** — Route guard. Runs on every request except static assets. Reads session from cookies, checks role, redirects as needed.

**`app/layout.tsx`** — Root layout. Wraps everything in ThemeProvider (next-themes), loads Plus Jakarta Sans font, adds Toaster (sonner) for notifications.

**`CLAUDE.md`** (in project root) — Hard rules for Claude Code:
- All financial calculations in Postgres, never TypeScript
- Stock quantity derived from stock_movements sum, never stored directly
- Forex rate locked at GRN confirmation, never recalculate after
- Zero-CBM shipment line → block GRN with clear error
- SKU hierarchy = 7 levels
- Push to GitHub after every confirmed working change
- Never call Supabase directly in pages — always via lib/queries/

**No test configuration** — no jest.config, no vitest.config, no playwright.config.

**`.gitignore`** — Standard Next.js gitignore, includes .env.local.

---

## 9. EXPERT PANEL

Ali gave Claude a series of expert personas and panel references to bring into design and decision-making. These have influenced the architecture, UX decisions, and business logic throughout the build.

### Business & Operations Experts
- **FMCG Distribution Expert** — Informed the entire business model understanding: import → land → sell → collect. Drove decisions around landed cost calculation, FIFO inventory, forex locking, shared container freight apportionment by CBM, and the concept of GRN (Goods Received Note) as the moment costs are permanently locked
- **ERP Expert** — Influenced the strict data hierarchy (Brand → Model → Variant → SKU), the no-stored-stock rule (always derive from movements), the audit_log append-only table, and the principle that financial data should never be editable once confirmed
- **Inventory & Costing Expert** — Drove the FIFO batch stock design, the days-of-stock (DIR) formula for reorder alerts, the distinction between qty_cartons (ordered, used for freight apportionment) vs qty_cartons_actual (received, used for FOB and stock), and the landed cost formula
- **Accounts & Finance Expert** — Influenced the P&L waterfall design in financials, the separation of AR (accounts receivable from credit customers) vs COD cash in drivers' hands, the gross margin calculation in Postgres, and the insistence that total_landed_cost_mvr be computed in Postgres (migration 0019 was specifically to fix a TypeScript calculation violation)
- **McKinsey-style business analyst** — Referenced for KPI selection on the dashboard; influenced the framing of metrics as "what does the owner need to know in 10 seconds?"

### UX & Design Experts
- **IDEO** — Human-centred design philosophy; influenced the principle that every interaction should be designed around the physical context (godown manager with one hand, delivery guy on a motorbike, owner reviewing numbers while multitasking)
- **Work & Co** — Digital product craft; influenced the Liquid Glass aesthetic decision (glassmorphism matching iOS 18 design language), the use of CSS custom properties everywhere, and the decision to never hardcode hex colours
- **NNG (Nielsen Norman Group)** — UX research and usability principles; informed the 5-tap rule (every common action ≤ 5 taps), the "recents first" pattern in all pickers, the no-confirm-for-non-destructive rule (undo toast instead), and the minimum 44pt touch target rule
- **Frog Design** — Interaction design influence; informed the spring physics preference for animations, the "every animation must convey cause and effect" rule, and the spatial continuity principle for sheet transitions
- **UX Studio** — Product design; influenced the progressive disclosure pattern in the New SKU wizard, the decision to collapse volume-break pricing by default, and the inline create patterns throughout
- **Metalab** — Quality bar for mobile craft; influenced the Liquid Glass visual system, the consistent use of `env(safe-area-inset-*)` throughout, and the commitment to making every pixel feel intentional

### Mobile-Specific Expert Panel
The **Mobile UX Expert** persona (installed as a Claude skill) brought:
- The 5-laws doctrine: Scan First / Every Common Action ≤ 5 Taps / Recents Always First / Never Confirm What You Don't Need To / Smart Defaults Reduce Typing
- Bottom-nav max 5 items rule (led to the "More" overflow sheet pattern)
- Thumb-zone design (primary actions in bottom 60% of screen)
- Offline-first thinking (though offline is not yet implemented — flagged as incomplete)
- The delivery guy view design (stripped interface, 3 big buttons only)

### How These Influenced the App

1. **Liquid Glass design system** (Work & Co + Metalab) — All cards use `background: var(--glass-bg-1)` + `backdrop-filter: blur(28px) saturate(180%)`. All modals use `glass-bg-2`. Specular highlight on every surface via `inset 0 1px 0 rgba(255,255,255,1)`. No hardcoded hex colours anywhere.

2. **iOS-native feel** (NNG + Frog + Apple HIG) — Bottom sheet pattern for all modals on mobile (implemented in dialog.tsx). `env(safe-area-inset-*)` on all fixed elements. `min-height: 44px` for all interactive elements. `touch-action: manipulation` to eliminate 300ms tap delay. `-webkit-user-select: none` to block text selection like a native app. `overscroll-behavior-y: contain` for proper scroll feel.

3. **Financial calculation discipline** (Accounts expert + ERP expert) — The hard rule "no financial math in TypeScript" has been enforced multiple times (migration 0019 was specifically to fix a violation where UI was multiplying landed_per_piece × qty). All margin calculations, landed costs, and selling prices live in Postgres views and RPCs.

4. **FIFO + movement ledger** (Inventory expert) — Stock is never stored as a direct number. Every stock change — GRN, sale, adjustment, transfer — writes a `stock_movements` row. Current stock = SUM of those movements. This is the accounting-ledger approach.

5. **GRN forex locking** (ERP + FMCG expert) — The exchange rate at the moment of GRN confirmation is burned into `inventory_batches.landed_per_piece_mvr` and locked by a database trigger. No future forex change can affect the cost of goods already received.

---

## 10. KNOWN ISSUES & INCOMPLETE WORK

### Confirmed bugs that were fixed in the session immediately before this audit:
- **Category pill delete not reflecting in UI** — Fixed. After `deleteCategory()` the pill now disappears immediately via a `deletedCategoryIds` Set.
- **Stale model names (Blue/Purple/Red test data) in model dropdown** — Fixed by adding × delete button per model row wired to `deleteModel()` with a confirm sheet and `deletedModelIds` Set.
- **Format pills could not be deselected** — Fixed. Clicking an active pill now toggles it off. Options trimmed to Bottle/Pouch/Pack/Box. Custom "Other…" text input added.
- **New SKU wizard top overlapping Dynamic Island** — Fixed. Dialog on mobile is now a bottom sheet (slides up from bottom). `maxHeight: calc(100dvh - env(safe-area-inset-top, 44px) - 8px)`.

### Known issues and incomplete work NOT yet addressed:

1. **No offline support** — The mobile UX expert spec called for offline-first (queue sales orders, sync later). Not implemented. The app requires an internet connection for all operations.

2. **No barcode scanner integration** — The scanner was planned as the primary input method for SKU selection (Law 1: Scan First). Currently users type/search. Camera-based barcode scanning was designed but never wired up.

3. **No real-time sync** — The app does not use Supabase Realtime subscriptions. Data is stale after page load. Refreshing requires a page reload. This is fine for single-user but problematic when multiple staff members use it simultaneously.

4. **No push notifications** — Delivery drivers should receive push notifications when a new order is assigned to them. Not implemented.

5. **Mixed carton fill workflow is incomplete** — The `is_mixed_carton_fill` flag was added to sales_order_lines (migration 0027) and the data model is correct. But the UI entry point for assembling a mixed carton (picking multiple SKUs at carton-rate-per-piece) is not clearly surfaced in the sales wizard. It exists as a flag on individual lines but the workflow for doing it intentionally is unclear.

6. **COD reconciliation UI is incomplete** — The `get_cod_reconciliation()` RPC exists and is tested. The UI in financials shows the data but the "mark as deposited" action (which should flip cash_deposited_at on the sales_order) is not wired up with a clear button.

7. **No transfer between godowns** — The `stock_movements` table supports `transfer_in` and `transfer_out` movement types, but there is no UI to perform a godown-to-godown stock transfer.

8. **Labels: brandName field is empty** — In `lib/queries/labels.ts`, the `getLabelData()` function sets `brandName: ""` — the brand name is not joined in the query (the brand is two levels above the variant in the join path: sku → variant → product_model → product_categories, but brands is on product_models via brand_id). This means if a template ever uses `data.brandName` it will be blank. The label templates currently use `data.modelName` and `data.variantDisplay` so it is not visible yet, but it is a bug.

9. **No pagination** — The products list, sales list, shipments list, and reports all fetch all records. This will cause performance problems as data grows. No `LIMIT/OFFSET` or cursor pagination is implemented.

10. **Supabase RLS not audited** — Row Level Security policies exist on all tables but have never been formally audited for gaps. In particular, the `lib/supabase.ts` browser client is used in "use client" components, meaning queries run with the anon key and RLS. Any gap in RLS could expose data to unauthorised users.

11. **`user_profiles` email column** — The `user_profiles` table was updated with an `email` column in the invite flow (`upsert` in the invite-user API route sets email). But the original table definition in migration 0002 does not have an `email` column. This was added informally — it may or may not have been applied to the live DB. This needs verification.

12. **Settings page viewer access** — The middleware allows viewer role to access `/settings`. But the settings page shows user management. Viewer should probably not see this, or it should be clearly read-only. Currently the UI gates write buttons on `canWrite` but the page itself is accessible.

13. **No form validation on several forms** — Several modals (add competitor price, add expense, add shipment line) do minimal validation client-side and rely on Postgres constraints to reject bad data. Error messages from Postgres errors are surfaced via `toast.error((e as Error).message)` which can be technical/confusing.

14. **`lib/queries/products.ts` has `"use client"` directive** — This file is imported by server components indirectly via the New SKU wizard. The `"use client"` directive at the top means this file creates a browser Supabase client. If any server component imports from this file, it would silently fail or use the wrong client. Currently pages use `getSupabaseServer()` correctly for their own queries, but this is an architectural risk.

15. **No SKU notes field in the UI** — `skus.notes` exists in the DB schema and TypeScript type but there is no input field for it in the New SKU wizard or Edit SKU dialog.

16. **Missing `delivery_address_line2` in some older sales orders** — Migration 0029 renamed `delivery_address` to `delivery_address_line1` and added `delivery_address_line2`. Any sales order created before this migration was applied will have the data in `delivery_address_line1`, but the label will only show line 1 (which is correct). However, if the migration was not applied cleanly to the live DB, the column rename could have broken things.

---

## 11. IMPORTANT DECISIONS

### Decision 1: Bottom sheet instead of centred modal on mobile
The shadcn `Dialog` component defaults to `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` (centred). On iPhones with Dynamic Island (iPhone 14 Pro, 15 Pro, 16 Pro), a tall modal like the New SKU wizard had its top header disappearing behind the Dynamic Island, making it impossible to close. The decision was made to convert all Dialog modals to bottom sheets on mobile (< 640px). On desktop they remain centred. This was done by overriding `dialog.tsx` with mobile-first positioning (`bottom-0 rounded-t-[28px]`) and a `maxHeight` formula that accounts for `env(safe-area-inset-top)`.

### Decision 2: All financial calculations in Postgres
This was established as a hard rule from the start, informed by the ERP expert perspective. Violations were caught and fixed: migration 0019 moved the `total_landed_cost_mvr = landed_per_piece × qty` calculation from the UI (TypeScript multiplication) into the Postgres RPC. This rule must be enforced in the audit.

### Decision 3: Stock never stored directly
`stock_movements` is a ledger. Every stock change is an append. Current stock is always `SUM(qty_pieces)` from the ledger. This mirrors proper accounting practice and prevents stock-count bugs from updates happening in the wrong order. The `v_stock_levels` view materialises this sum.

### Decision 4: Forex locked at GRN
The moment `confirm_grn()` is called, `landed_per_piece_mvr` is computed and stored in `inventory_batches`. The forex rates used are stored in `shipments` and locked by the `block_grn_rate_changes` trigger (migration 0014). This means a GRN from 3 months ago always reports its original landed cost, even if the MVR/IDR rate has changed since then. This was the correct FMCG accounting decision.

### Decision 5: Viewer role
Added after the initial build (migration 0026). Viewer can see everything but write nothing. RLS policies already gate writes on `is_admin_or_manager()` so viewer is automatically excluded. The middleware checks role and allows all non-staff paths. The UI gates write buttons on a `canWrite` boolean computed from role. However `canWrite` had a bug where it initialised to `true` before the role loaded — fixed in commit `1da6eca`.

### Decision 6: Label templates use PNG base + SVG overlay
Rather than building the label entirely in code, the design has a PNG background (Ali's brand design files) with an SVG overlay for the live data. The SVG uses `viewBox="0 0 1240 1748"` (A6 @ 300 DPI pixel space). Coordinates were measured using browser Canvas API pixel sampling on the actual PNG — not estimated. This was necessary because the PNG had precise cell boundaries for text zones.

### Decision 7: Three Supabase clients
Three distinct clients for three contexts: browser client (anon key, RLS applies), server client (anon key, cookie-based session, RLS applies), admin client (service role, RLS bypassed). The admin client is only used in `app/api/admin/*` routes where the caller's admin role has already been verified by the server client. This separation prevents accidentally exposing the service role key to the browser.

### Decision 8: Price stored per-piece in DB
`fixed_selling_price_mvr` is always stored as the per-piece price, regardless of how the user entered it (per bottle or per carton). The UI converts at save time: carton entry divides by `pcs_per_pack × packs_per_carton`; bottle/pack entry divides by `pcs_per_pack`. This means the DB has one canonical price field and the UI can derive all other UoM prices from it.

### Decision 9: CBM apportionment uses ordered qty, FOB uses received qty
Migration 0015 established this important distinction. Freight cost is apportioned by CBM × qty_cartons (ordered) because the freight slot was reserved and paid for when the container was booked. FOB (supplier invoice) uses qty_cartons_actual (what actually arrived). This correctly handles short shipments without distorting either the freight cost or the supplier cost.

### Decision 10: SKU hierarchy levels
Seven levels: Brand → Category → Model → Variant → Packaging → Unit Size → (Units/Pack + Packs/Carton). This was established in migration 0002 after the initial schema in 0001 was found to be too flat. The rebuild recognised that a Mamypoko M-size diaper comes in different pack configurations (22 pcs/pack × 4 packs = 88 pcs/carton vs 18 pcs/pack × 3 packs = 54 pcs/carton) — these are different SKUs of the same variant.

---

## 12. AUDIT INSTRUCTIONS

**The next task in the new chat is to run a full audit of the SayNoMore app.**

The audit should cover the following areas in order of risk:

### Area 1: Security
- Audit all Supabase RLS policies on every table. Check for tables missing RLS, policies too permissive, or gaps where a logged-in user could read/write another user's data.
- Check whether the `user_profiles` table RLS allows any authenticated user to read other users' roles (information disclosure).
- Check the admin API routes (`app/api/admin/*`) — verify caller validation is solid; check for missing auth checks, missing role checks, or injection risks.
- Check the `supabase-admin.ts` client — verify it is NEVER imported in client components or in `lib/queries/*.ts` (which have `"use client"` directives).
- Check middleware for gaps — are there any routes accessible without auth? Can staff access manager routes by direct URL?
- Check that `SUPABASE_SERVICE_ROLE_KEY` cannot leak to the browser (it must only be in `app/api/admin/*`).

### Area 2: Database
- Verify the `email` column on `user_profiles` — does it actually exist in the live DB or is the `upsert` in invite-user silently failing?
- Verify migration 0029 (split delivery address) was applied and did not break any views or functions that referenced the old `delivery_address` column name.
- Check `v_skus` view — it is rebuilt multiple times across migrations (0003, 0007, 0012, 0013). Verify the final state of this view is correct and handles all pricing tiers.
- Check `confirm_grn()` — the most critical function. Verify it handles edge cases: what happens if a line's FOB currency is MVR (no conversion needed)? What if qty_cartons_actual is NULL?
- Check `post_sale()` — verify FIFO deduction is correct and what happens if stock runs out mid-order (should block, but verify the error is user-friendly).
- Check all `ON DELETE` constraints — are there any places where deleting a parent record could silently orphan child records?
- Verify `audit_log` — is the append-only RLS policy actually blocking UPDATE and DELETE?

### Area 3: Bugs
- Test the category pill delete: the `deletedCategoryIds` Set approach works in the wizard session, but the parent `categories` prop (fetched at page load) is not refreshed. When the wizard closes and reopens, the deleted category may reappear until the page is reloaded.
- Test the model delete: same concern — `deletedModelIds` Set works in session but the parent `models` prop is stale.
- Verify the `brandName` field in `getLabelData()` — it is set to `""` currently. If any label template starts using it, it will print blank.
- Check `fixed_selling_price_mvr` save logic in New SKU wizard: when `fixedEntryUnit === "bottle"`, the formula is `parseFloat(fixedPrice) / parseInt(pcsPerPack)`. This is correct for per-pack entry labelled as "per bottle". Verify the label "/ Bottle" actually maps to packs (since a "bottle" in this context = one pack of detergent).
- Check the `COD reconciliation` flow — `get_cod_reconciliation()` RPC exists but the "mark as deposited" button in the UI is unclear or missing.
- Check the `canWrite` initialisation — the previous bug (initialising to `true` before role loads) was fixed, but verify the fix is solid and there is no flash of write-enabled UI before the role is confirmed.

### Area 4: UI/UX
- Test every modal and sheet on iPhone screen sizes (375px, 390px, 430px) for Dynamic Island / notch overlap. The dialog.tsx fix converts dialogs to bottom sheets on mobile, but check that every individual modal across every module uses the correct pattern.
- Test the bottom navigation on iPhone with home indicator — verify `env(safe-area-inset-bottom)` is correctly applied and content is not hidden behind the home bar.
- Check the SKU detail bottom sheet height — previously set to `height: 80vh` (fixed), now uses `maxHeight: calc(100dvh - env(safe-area-inset-top, 44px) - 8px)`. Verify the panel scrolls correctly on smaller phones.
- Check the price lists view full-screen panels — all three overlays use `snm-overlay-header`. Verify the header clears the Dynamic Island correctly.
- Check the New SKU wizard on mobile — with the dialog now as a bottom sheet, verify the wizard's scrollable body (`maxHeight: calc(100dvh - 200px)`) does not cause nested scroll conflicts.
- Check all `touch-action`, `overscroll-behavior`, and `-webkit-overflow-scrolling` settings — verify no content is unscrollable on mobile.
- Check the Bottom Nav "More" sheet — verify it opens correctly on top of the fixed bottom nav and the drag-to-close gesture works.
- Check that all form inputs on mobile trigger the correct keyboard type (`inputMode="decimal"` for prices, `inputMode="numeric"` for quantities, `type="email"` for email fields).
- Check all filter chip sets for horizontal scroll overflow — they should scroll horizontally, not wrap onto multiple lines.
- Verify that the Toaster (sonner) is always visible above all modals — check z-index stacking.

### Notes for the auditor:
- Read `CLAUDE.md` in the project root for the hard rules that must not be broken
- Read this `AUDIT_BRIEF.md` file for full context
- The Supabase project reference is `smhdwkrmiytvpsgqezsl`
- The live app is at `https://saynomore-beta.vercel.app`
- The GitHub repo is `https://github.com/kudanulafaa-zahab/saynomore`
- All 29 migrations are in `supabase/migrations/` — read them in order to understand the full schema history
- The most critical Postgres functions are `confirm_grn()` and `post_sale()` — any bug here loses money or corrupts stock
- Do not make any changes without first reading the relevant source file in full
- Push to GitHub after every confirmed working change
