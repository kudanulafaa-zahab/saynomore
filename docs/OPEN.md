# The register — what is open, and what "done" means

**Why this file exists.** Ali, 2026-08-23, with a diagram of the seven phases of
a design and development process: *"Did you properly do everything in this
image? If not can you do it properly like a full team. Do not skip and do adhoc
work."*

The honest answer was no. Three phases were done well, three badly, and the
three done badly are precisely what produced the failures he has had to report
himself. This file is the fix for two of them, because they were failures of
RECORD-KEEPING, not of engineering skill:

- **Phase 1, requirements** — work started from my own reading of the ask
  instead of from a written statement of what "done" means. Lumen v1 is the
  proof: a whole theme built without a written definition of "different", and it
  took a screenshot from Ali to find out it was not.
- **Phase 7, support and management** — open findings were written into HANDOFF
  prose and then effectively lost. Nobody, including me, could answer "what is
  outstanding?" without re-reading thousands of lines.

**The rule this file enforces:** nothing is closed here until it is LIVE and Ali
can use it. `npm run shipped` is the only evidence accepted. "Fixed", "pushed",
"CI green" and "merged" are all steps, not outcomes — and reporting one of them
as an outcome is what happened with the Pricing Tool crash, which was called
fixed while his screen was still broken.

---

## OPEN — needs a decision from Ali

| # | What | Why it needs him, not me |
|---|---|---|
| O1 | **Soft's `.glass-panel` still carries the old glass shadow.** Found by Lumen's material law; Soft's own law cannot see it (it fires only on a SINGLE non-inset shadow, and this list has two). The value is now a token, so the fix is one line: `--glass-panel-shadow: var(--soft-raised)`. | It changes how a theme he already uses looks. A visible change to existing work is his call, not mine. |
| ~~O2~~ | **CLOSED 2026-08-23 — and I had it backwards.** This was recorded as "a money test asserting a rule the catalogue has outgrown". It was the opposite: the test was right and the DATA was a defect. Those 5 Body Shop tubs — 16 in stock, ~MVR 6,000 — carried `sellable_units = {piece}`, and `assert_whole_mixed_cartons` refuses a piece line for a brand with no `mixed_carton_pieces`. The sell sheet offered one button that could never complete a sale. Not slow-moving: **impossible to sell**. Ali answered "you decide"; the decision was to keep the rule and fix the catalogue. Detail in E5 below. |
| ~~O3~~ | **CLOSED 2026-08-23** — Ali: *"Delete"*. `components/labels/snm-assets.tsx` removed in `0965e79`. |

## OPEN — data, not code

| # | What | Impact |
|---|---|---|
| D1 | **X-Tra Kering XXXL 34s has no carton price.** Found while checking the Pricing Tool fix against production. Ali, 2026-08-23: *"I will set later. Don't worry."* — his, deferred by him, not forgotten. | The app cannot tell him what a carton of it costs. Not a bug — a blank field. |
| D2 | **CBM is approximate on most SKUs** — filled from a single measurement. 31 SKUs share 5 carton sizes, and 3 of them carry 85% of freight. Ali, 2026-08-23: *"Carton sizes I will enter."* | Five measurements would make every landed cost materially better. His own note, 2026-08-05. |
| D3 | **Three of the five Body Shop tubs have cost equal to price** — they earn exactly nothing per tub. Found while fixing E5; deliberately not touched, because a selling price is Ali's and is never auto-overwritten (skills.md, Seat 4). | Now that they can be sold at all, the next question is what for. Margin Watch will surface them; the number to change is his. |
| D5 | **Rose & Water Lily has no single-bottle price**, and the other four Sosoft will quote **MVR 37** — which is the MVR 220 carton price divided by six, a figure the app derived rather than one Ali chose. Singles normally carry a premium over the case rate, so all five are worth a decision, not only the blank one. A selling price is his and is never auto-set (skills.md, Seat 4). | Rose & Water Lily cannot be sold by the bottle at all until he sets one; it now says so on the Products screen. |
| D4 | **Five products are not finished being set up** — the Body Shop tubs, none of which has carton measurements. They appear on the Products screen with what is missing and what it blocks (E9). **Corrected from "nine":** the first count came from reading the fixed-price columns and missing `target_margin_pct`, which is also a price — X-Tra Kering NB/S, Skin Comfort XXL and Mama Lime are all quotable by the sell sheet and were false alarms (E12). | A GRN carrying any of the five is blocked the day it ships, under hard rule 4. Five measurements, and only Ali has the cartons. |

## OPEN — engineering, mine to finish

| # | What | Status |
|---|---|---|
| E1 | **CLOSED 2026-08-23.** Recorded as ONE drifted column; a full schema comparison found **THREE**, all on `sales_orders` — `godown_id`, `dispatched_at`, `payment_ref`. Each proven dead first: 0 of 129 rows carried a value, 0 views depended on it (`pg_depend`), 0 functions referenced it by a qualified name, 0 mentions anywhere in the app source, and no migration created any of them. Migration 0198 dropped them behind a guard that refuses if any of those facts changed. Production is now 483 columns — exactly what the migrations build. `npm run drift` finds the next one. |
| E2 | **Two Supabase Auth settings left alone deliberately**: leaked-password protection off, OTP expiry long. | Dashboard-only settings; flagged rather than changed without asking. |
| E3 | ~~Money formatters are not total~~ — turned out to be **23 private formatters across 18 files**, not two. All delegate to `lib/money.ts` now; a missing figure reads "—" instead of "0" or "NaN". Locked by `audit:onedef`, mutation-proven both ways. | **CLOSED 2026-08-23** — live on `49461ad`, verified by `npm run shipped`. |
| E4 | ~~68 inline `toLocaleString` calls~~ — all migrated, plus **six more private formatters** named `mvr`/`mvrShort`/`num`/`int`/`money` that E3's check could not see because it only looked for names starting with `fmt`. The gate now states the invariant over the whole file rather than per declaration: **outside `lib/`, no `toLocaleString` with number options exists at all**. Dates untouched. | **CLOSED 2026-08-23** — live on `f13ced9`, verified by `npm run shipped`. |
| E5 | **A product the app created and then refused to sell.** Five Body Shop tubs, 16 in stock, never sold once. `sellableUnitsFor()` returned `["piece"]` for every unit that is not pcs/ml/g, so every tub, jar, bar, tube, bottle, sachet and **set** born through the app — the IKEA bedding included — was unsellable. Fixed at all four layers: the function (`["pack"]`), the 5 rows (0200), the CATEGORY that would have minted the next one (0201), and the rule that makes it unrepresentable — **`piece` may never be the only unit a thing sells in**, now a CHECK on `skus` and `product_categories`, probe-proven inside the migration and in pgTAP. | **CLOSED — pending `npm run shipped`.** |
| E6 | **The unit noun was re-derived in five places.** Swept after E5: `sku.unit_uom === "ml" ? "bottle" : … : "pack"` was open-coded in Price Lists, Market ×2 and Shipment Detail, and Add-stock reached for the product's own noun only on the `piece` tier — so the moment 0201 moved single items onto `pack`, a tub read "How many packs". All five now call `containerLabel`. `audit:onedef` fails on any file outside the owning module that mentions "pouch", the word that only exists as part of the mapping. Mutation-proven. | **CLOSED — pending `npm run shipped`.** |
| E8 | **Two engines disagreed about whether a product has a price.** The sell sheet showed MVR 380 a tub while Margin Watch called the same row unpriced — and since E5 moved every single item onto the `pack` tier, *every product Ali adds from now on* landed in that shape and would have been reported unpriced for ever. `price_per_unit` (0202) is the one definition, and it falls back to the per-piece column ONLY where one piece is one unit: the tempting version, scaling by pack size, would have silently undone migration 0162's guard that a 32-per-pack diaper carrying only a per-piece figure has no pack price. Both mutations are proven to fail. | **CLOSED — pending `npm run shipped`.** |
| E9 | **A half-finished product was invisible until it cost money.** Margin Watch only looks at products that HAVE STOCK, by design — so X-Tra Kering NB/S, with no price on any unit at all, could not be seen until a container landed. Five Body Shop tubs have no carton size, which blocks the GRN under hard rule 4, and nothing said so. `get_setup_gaps()` is the master-data completeness check: every gap, what it blocks, in trade units, silent when the catalogue is clean. Deliberately a **report and not a constraint** — a product is added the day it is heard about, long before its carton is measured. | **CLOSED — pending `npm run shipped`.** |
| E10 | **anon could execute five functions it should not, including the whole Cost Simulator engine.** Found because 0202's own guard refused an apply: `REVOKE … FROM anon` and `REVOKE … FROM PUBLIC` are different revokes — Postgres grants PUBLIC by default, Supabase's default privileges grant `anon` *explicitly* — and the local stack carries no such setting, so one revoke looks sufficient locally and is not on production. `rls_surface`'s existing check only covered SECURITY DEFINER functions, which is exactly why `simulate_landed_costs` (INVOKER) slipped through. 0203 revokes by enumeration and the test now covers every function, `keepalive` excepted. | **CLOSED — pending `npm run shipped`.** |
| E12 | **The readiness report's first live answer was wrong, and plausibly wrong.** It announced *"Xtra Kering NB/S — No price for a carton — sells by the pack, but a carton cannot be quoted"*. Both halves false: that SKU carries `target_margin_pct = 44.90` and the sell sheet quotes MVR 170 a pack, MVR 680 a carton from it. E8's own header claims to remove a second opinion about what a price is — it removed one and built a third, asking *"is a fixed price stored"* where the question that matters is *"can a number be quoted today"*. 0204 makes the report read `v_skus`, the sell sheet's own columns, so it cannot contradict what a customer would be charged. Live count went 8 → 5, and the three that dropped were the false ones. **The lesson is not "be more careful": a new report must READ the existing answer, never recompute it, however simple the recomputation looks.** | **CLOSED — pending `npm run shipped`.** |
| E13 | **A name typed wrong could never be corrected.** Ali, 2026-08-24: *"I entered a product name by mistake... How can I correct this and any other future mistakes?"* — and *"Wrong name"* when asked whether the product was real. He was stuck in both directions: `BODY-BODY-1x1` has 4 tubs in stock so DELETE was correctly refused, and RENAME did not exist — `updateBrand`/`updateModel`/`updateVariant` have sat in `lib/queries/products.ts` the whole time, called from nowhere, since their dialogs were deleted as dead code on 2026-08-10 with a note claiming names were edited elsewhere. They were not. 0205 adds `rename_catalogue_part` and a Name section at the top of the product's edit sheet. **The SKU code deliberately does not change** — SAP/Oracle/NetSuite convention: the code is the permanent reference on labels and paperwork, the name is the description. | **CLOSED — pending `npm run shipped`.** |
| E14 | **The readiness panel was wrong three ways, and Ali caught all three.** *"the message is confusing. And the pill doesn't have any function."* (1) The count was painted in error/warning colour — which in this app means status or tappable — for pure metadata; neutral now. (2) One problem across five products was drawn as five identical rows, so the same two lines had to be read five times; grouped by problem, stated once. (3) **His screenshot showed the third fault I had not seen**: five expanded rows pushed the tabs and the search box off the phone, so a panel about products he could not receive stood between him and finding any product. Collapsed to one line by default, and every product is now a link into its edit sheet through the `?editSku=` deep link that already existed. | **CLOSED — pending `npm run shipped`.** |
| E15 | **A promotional giveaway had nowhere to go.** Ali, 2026-08-24: *"I launched an Instagram giveaway promotion for a case of diapers... Since it's not a sale I will still have to enter it to the system and deduct from stock."* Goods given away to win customers are **advertising expense at cost** — SAP, Oracle, NetSuite and standard FMCG practice — so 0206 deducts FIFO at locked landed cost and charges that to the named campaign as `marketing_spend`. **Not a sale at MVR 0** (it would put the winner in customer history so the follow-up round chases them, drop average order value, and show COGS with no revenue) and **not a write-off** (that line means shrinkage; mixing promotions in means next month's rise cannot distinguish a storage problem from a campaign). `movement_type` stays `'out'` deliberately: `stock_signed_delta` ends in `ELSE 0`, so a new movement type would post the cost and never deduct the stock — a silent failure found only at the next count. Both mutations proven to fail. | **CLOSED — pending `npm run shipped`.** |
| E16 | **Stock Ops offered a loose "pcs" tier on the giveaway sheet.** CLAUDE.md allows a loose tier in Stock Ops because a write-off or a count is a *ledger* event — a torn pack is real. A giveaway is a **trade** event: prizes are given in packs and cartons, as they are sold, and nobody hands a stranger loose diapers. `UnitToggle` now takes `tradeOnly`, and the giveaway sheet defaults to a trade tier. Caught by the browser audit, not by review. | **CLOSED — pending `npm run shipped`.** |
| E17 | **A Sosoft bottle could not be sold or given away on its own.** Ali, 2026-08-24: *"I must be able to give away sosoft individual bottles too. I also must have an option to sell the sosoft bottle individually if I want. But leave the current setup for mix a case and whole carton as it is."* **Not an exception to the units rule**: every Sosoft SKU is `1 × 6`, so one piece IS one whole bottle and the PACK tier is a single bottle — `sellUnitLabel` has named this product in its own comment all along. No `piece` tier was added, 0201's rule stands, and a loose piece line is still refused. The mixed carton is gated on `brands.mixed_carton_pieces`, never on `sellable_units`, so it is untouched — asserted, not argued. Stock Ops' unit toggle also stopped *inferring* trade tiers from pack numbers (`pcs_per_pack > 1`), which hid the bottle for exactly this shape; it reads `sellable_units` now, like the sell sheet. | **CLOSED — pending `npm run shipped`.** |
| E18 | **A missing single-unit price was invisible.** `get_setup_gaps` had a branch for "sells by the carton but no carton price" and **no mirror** — so enabling Sosoft's bottle tier would have reported as finished the one SKU that cannot be quoted a bottle at all. Found by doing the work, not by review. 0208 adds `no_unit_price`, worded in the product's own noun, and it caught **Rose & Water Lily** on production the moment it shipped. | **CLOSED — pending `npm run shipped`.** |
| ~~E11~~ | **CLOSED — and it was not a harmless leftover.** Recorded as "a drifted function, probably dead". Asked what used it, production answered: a LIVE TRIGGER on `skus`, so every SKU update ran the pack-size rule **twice** — `trg_guard_sku_pack_config` alongside 0190's `trg_block_pack_config_change`. Same class migration 0195 fixed for CHECK constraints; nothing guarded triggers. 0190's is strictly stronger (blocks on sales as well as batches, SECURITY DEFINER so row security cannot blind it), **but the drifted one wrote an audit row on the allowed path and 0190 did not** — so that insert moved into 0190's function before the old pair was dropped. A cleanup must not lose the half of a duplicate that was working. `npm run drift` now compares **functions and triggers**, not just columns — it could never have seen this — and `rls_surface` gained a duplicate-trigger check, mutation-proven. | **CLOSED — pending `npm run shipped`.** |
| ~~E7~~ | **CLOSED.** The Cost Simulator's new-product sheet offered three unit words of eleven, so a trial for a tub or a bedding set could not be described — the same shape as the blocker Ali hit adding IKEA, in the one screen where a product has no SKU to read its word from. The trial now stores the **unit** and derives the word through `containerLabel`, and the picker is the New Category form's own markup with all eleven words and their hints. **The `audit:onedef` exemption that covered this file is gone**, so the no-second-noun-mapping rule now genuinely applies to it; the check strips comments first, because a guard a comment can trip is one that gets silenced by deleting the comment (the lesson from 0204). Mutation-proven. | **CLOSED — pending `npm run shipped`.** |

---

## Definition of done — every item, no exceptions

An item is not closed until every line is true:

1. **Requirement written first**, with acceptance criteria Ali could have
   disagreed with BEFORE the work started.
2. **A test exists that fails without the fix.** Mutation-proven: the check was
   watched failing, not assumed to work.
3. **The test is registered in all three places** — npm script, `audit:ui`
   chain, CI workflow. This has been missed three times in one week
   (nav-config, `audit:onedef`, `audit:material:lumen`); a list a human must
   remember to extend is not a gate.
4. **The gate is green**: `npx supabase test db` AND `npm run audit:ui`.
5. **`npm run shipped` passes** — the running site serves the merged commit.
6. **Ali can open the app and use it.** A migration without its screen is not a
   delivery.

## Phase scorecard, honestly

| Phase | Verdict |
|---|---|
| 1 Requirements gathering | **WEAK** — built from my own reading. Lumen v1 and the Pricing Tool both trace here. This file plus written acceptance criteria are the fix. |
| 2 Analysis and planning | **PARTIAL** — done properly when asked ("plan the steps first"), skipped when not. |
| 3 Security & performance architecture | **STRONG** — 14 vulnerabilities to 0, row security 52.85→3.22 ms, dashboard 64→51 ms, every definer function search-path pinned and anon-revoked, enumerated by test rather than by memory. |
| 4 Agile development | **PARTIAL** — incremental PRs, but no backlog and no per-item definition of done until now. |
| 5 System testing | **STRONG but blind in places** — 406 pgTAP + 28 audits / 649 checks, all mutation-proven. The blind spots (a fixture with zero competitors; never changing the SKU in a picker) were phase-1 failures surfacing in phase 5: a test cannot cover a requirement nobody wrote down. **E5 is the sharpest example yet**: every gate was green while five products in the catalogue could not be sold at all, because the audit fixtures themselves wrote the defective shape — a test that sets up the bug can never catch it. Three fixtures now assert the correct shape and the database refuses the wrong one. |
| 6 Deployment | **BROKEN TWICE** — "fixed" reported while the fix sat in an unmerged PR and his screen was still broken. The rule already existed in writing; what was missing was making LIVE the only closing condition, which is now line 5 above. |
| 7 Support & management | **WEAK** — open findings lived in prose and were effectively lost. This file is the fix. |
