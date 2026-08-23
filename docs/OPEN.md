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
| O2 | **Two pgTAP rules the catalogue has outgrown.** `money_rules` tests 6 and 7 assert "no SKU is sellable by the piece" and "no sale line uses a unit its SKU does not sell". Both are violated on production by data that is CORRECT: 5 Body Shop tubs where one piece IS one tub (the app shows "tub", never "piece"), and 108 Sosoft lines that are loose bottles from mixed cartons. | Rewriting what a MONEY test asserts is not a call to make quietly. The likely correct rule is "…unless one piece is one whole item", but that wants deciding. |
| O3 | **`components/labels/snm-assets.tsx` is unreferenced (249 lines).** CorelDRAW-extracted artwork, not recreatable from anything in this repo. | Deleting it is the one irreversible mistake available in a cleanup. Keep or delete is his call. |

## OPEN — data, not code

| # | What | Impact |
|---|---|---|
| D1 | **X-Tra Kering XXXL 34s has no carton price.** Found while checking the Pricing Tool fix against production. | The app cannot tell him what a carton of it costs. Not a bug — a blank field. |
| D2 | **CBM is approximate on most SKUs** — filled from a single measurement. 31 SKUs share 5 carton sizes, and 3 of them carry 85% of freight. | Five measurements would make every landed cost materially better. His own note, 2026-08-05. |

## OPEN — engineering, mine to finish

| # | What | Status |
|---|---|---|
| E1 | **Schema drift**: production `sales_orders` has a `godown_id` column no migration creates (local has only `source_godown_id`). | Harmless today. Needs reconciling before it confuses a future migration. |
| E2 | **Two Supabase Auth settings left alone deliberately**: leaked-password protection off, OTP expiry long. | Dashboard-only settings; flagged rather than changed without asking. |
| E3 | ~~Money formatters are not total~~ — turned out to be **23 private formatters across 18 files**, not two. All delegate to `lib/money.ts` now; a missing figure reads "—" instead of "0" or "NaN". Locked by `audit:onedef`, mutation-proven both ways. | **CLOSED 2026-08-23** — live on `49461ad`, verified by `npm run shipped`. |
| E4 | ~~68 inline `toLocaleString` calls~~ — all migrated, plus **six more private formatters** named `mvr`/`mvrShort`/`num`/`int`/`money` that E3's check could not see because it only looked for names starting with `fmt`. The gate now states the invariant over the whole file rather than per declaration: **outside `lib/`, no `toLocaleString` with number options exists at all**. Dates untouched. | **CLOSED 2026-08-23** — live on `f13ced9`, verified by `npm run shipped`. |

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
| 5 System testing | **STRONG but blind in places** — 351 pgTAP + 25 audits / 572 checks, all mutation-proven. The blind spots (a fixture with zero competitors; never changing the SKU in a picker) were phase-1 failures surfacing in phase 5: a test cannot cover a requirement nobody wrote down. |
| 6 Deployment | **BROKEN TWICE** — "fixed" reported while the fix sat in an unmerged PR and his screen was still broken. The rule already existed in writing; what was missing was making LIVE the only closing condition, which is now line 5 above. |
| 7 Support & management | **WEAK** — open findings lived in prose and were effectively lost. This file is the fix. |
