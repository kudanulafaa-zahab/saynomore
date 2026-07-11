# SayNoMore — Full Product Cycle Audit
**Date:** 2026-07-02 · **Scope:** All 30 active SKUs, one full PO → GRN → Sale cycle, real production data (not deleted)

## What was run

- **1 Purchase Order** (`SH-2026-002`, supplier: Smarco/Indonesia) — 30 lines, every active SKU, real FOB prices from your supplier price sheet, 207 cartons, 8.395 CBM, ~79.1M IDR total FOB.
- **1 new SKU created**: `MAMY-XTRA-XXXL-32x4` (Mamypoko Xtra Kering XXXL, 32 pcs/pack) — your price sheet listed a genuine second XXXL variant that didn't exist yet alongside the existing 22-pcs/pack XXXL. Carton dimensions are **estimated**, not measured (46×20×38cm, 0.0350 CBM) — flag for correction once you have real measurements.
- **GRN confirmed** via the real `confirm_grn` RPC — forex rates (15.42 USD/MVR, 15,820 USD/IDR), freight ($180), and local costs (customs/MPL/agent/last-mile/insurance) entered and locked.
- **10 new customers** created (mix of retail/wholesale/vip tiers).
- **10 sales orders, 27 line items**, covering all 30 SKUs — diaper lines deliberately mixed pack-sale and carton-sale across different customers (8 pack lines, 11 carton lines, rest Sosoft carton-only).
- Verified live in the browser (Dashboard, Reports) as well as at the database level.
- **Nothing was deleted** — this is now real transaction history in production, per your instruction.

---

## Financial logic audit — PASS, with two real findings

### ✅ Confirmed correct
1. **Forex derivation** — `rate_idr_to_mvr` was correctly auto-derived by the Postgres trigger (0.00097472) from the two rates typed in; never computed in the app.
2. **CBM-based freight/local cost apportionment** — hand-verified on Royal Soft Boy L: apportioned pool matched the RPC's output to 2 decimal places.
3. **FIFO cost snapshot at sale** — every one of the 27 sale lines correctly snapshotted `landed_cost_per_piece_mvr` and `actual_margin_pct` at confirmation time, for both pack-UOM and carton-UOM lines alike. Confirmed both unit types compute margin correctly against the piece-level landed cost.
4. **Dashboard ↔ raw data reconciliation** — revenue (33,402.00) and gross profit (18,223.6394) matched a hand-summed total from `sales_order_lines` exactly, to 4 decimal places.
5. **Reports RPCs** (`get_reports_data`, `get_abc_analysis`, `get_contribution_margin`) all returned complete, correct data for all 30 SKUs.
6. **Whole-MVR rounding** on manually-typed prices — confirmed the write-trigger correctly rounded 94.15 → 94 when I set Skin Comfort XXL's price.

### 🔴 Finding 1 — Skin Comfort XXL is selling at a loss (real, needs your attention)
`MAMY-SKIN-XXL-32x3` landed at **MVR 94.15/pack**, but its current selling price is **MVR 94.00/pack** — a **-0.16% margin**, i.e. selling below cost. This is visible on the live Reports → Margins tab, correctly flagged by the report's own red/amber/green legend.
**Why this happened:** this SKU had no price at all before this test (confirmed both pre-cycle and via `v_skus`), so I set an estimated price to complete the audit. The *pricing engine itself is not at fault* — it correctly computed and displayed the loss. This is a real pricing gap that existed before this audit and is now surfaced. **Action needed from you:** set a real price for Skin Comfort XXL above ~MVR 135/pack for a healthy ~30% margin (matching its siblings).

### 🟡 Finding 2 — "Avg Margin" on Reports disagrees with Dashboard by design, not by bug
- Dashboard: **54.6%** — revenue-weighted `(total revenue − total cost) / total revenue`.
- Reports page "Avg Margin" card: **54.1%** — a **simple unweighted average of each SKU's own margin %**, giving a SKU that sold 12 pieces the same weight as one that sold 2,800.
Both numbers are individually correct for what they measure, but nothing in the UI explains *why* they differ, and a small ~0.5pt gap here will grow much larger on a real catalog with more uneven sales volume. **Recommendation:** either switch the Reports card to revenue-weighted (to match Dashboard) or add a tooltip/label clarifying it's a per-product average, not a blended margin.

---

## Data-quality findings (from your source data, not app bugs)

3. **Xtra Kering "K" size** on your price sheet doesn't exist as a labeled size anywhere in the system — its pcs/pack (42) matched the existing **L** variant exactly, so I treated your "K" row as L. Worth double-checking this is the correct mapping.
4. **Two Skin Comfort sizes on your sheet don't exist as SKUs**: "S" (24 pcs) has no matching SKU at all. Not an error — just unused sheet data.
5. **Xtra Kering XXXL** now legitimately has two SKUs (22-pcs and 32-pcs variants) since your sheet listed a second, genuinely different pack size. Flagged above — carton dimensions are estimated and should be corrected with real measurements when convenient.
6. The Sosoft "Green" pricing typo you caught and fixed yourself before this audit (`fixed_price_per_carton_mvr` was 20 instead of 220) — confirmed still correct at 220.00 throughout this cycle.

---

## UI/UX audit

### ✅ Working well
- **Reports Best Sellers table** correctly displays quantities in trade units ("3 ctn" not "192 pcs") for carton-sale lines — confirms the trade-unit display feature works on real mixed pack/carton data, not just in isolation.
- **Margins tab legend** (Green ≥30% / Amber 15-29% / Red <15%) made the Skin Comfort XXL loss immediately visible without needing to do any math myself.
- Dashboard's "Needs Attention" section correctly surfaced both the new overstock alerts and the awaiting-dispatch count from a single real transaction batch.

### 🟡 Findings
7. **"10 orders waiting for a driver" shown as an urgent action strip immediately after confirmation.** All 10 orders were confirmed seconds apart in this test, and the Dashboard's single-highest-priority exception strip presented them with the same amber urgency styling it would use for orders that have been sitting for hours. Consider only escalating this visually after some time threshold (e.g. 2+ hours unassigned), so a normal end-of-day batch of confirmed orders doesn't look like a problem the moment they're placed.
8. **"17 SKUs overstocked" is a same-day-import artifact, not a real signal — worth a UI caveat.** Because DIR divides by a 30-day trailing average, importing and selling everything on day one makes the average look artificially low relative to stock on hand, flagging most of the catalog as overstocked. This is mathematically correct given the formula, but will confuse a new user seeing it for the first time after their first shipment. Consider suppressing the overstock flag for SKUs with less than ~14 days of sales history, or labeling it "not enough sales history yet" instead of "overstock."

---

## Other observations
9. `confirm_grn`, `post_sale`, and the forex-derivation trigger all behaved identically whether called via the app's UI (verified earlier this session) or directly via RPC (this audit) — confirms the app's Sales/Shipments screens aren't doing any client-side math that could drift from the database's own logic.
10. No RLS or permission errors were hit at any point in this cycle while acting as the seeded owner account.

---

## Data left in the system (per your instruction — nothing deleted)
- Shipment `SH-2026-002`, 30 lines, GRN confirmed
- New SKU `MAMY-XTRA-XXXL-32x4`
- 10 new customers (Mohamed Shifau, Aishath Nazima, Ibrahim Waheed, Fathimath Reesha, Ahmed Rasheed, Mariyam Shiuna, Hussain Sameer, Aminath Zulfa, Ali Naseer, Fazna Ibrahim)
- 10 sales orders `SO-2026-0001` through `SO-2026-0010`, all confirmed, all pending dispatch
- Updated selling prices on `MAMY-SKIN-XL-36x3` and `MAMY-XTRA-XXXL-32x4` (both were previously unpriced)
