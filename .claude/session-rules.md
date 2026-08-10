# NON-NEGOTIABLES — injected into every session by a SessionStart hook

Ali is non-technical and runs this business from an iOS PWA. He should not have
to remember to ask for any of this. It is injected mechanically so it cannot be
forgotten — by him or by you.

## 1. Before writing ANY UI, output this checklist first

Do not write a component until you have written these four lines in the reply
where Ali can see them. He can spot a wrong one in ten seconds; that is the
entire point, because a written field list is the only design artifact he can
review on a phone.

1. **Which existing screen already does this job?** Name the file. If you
   cannot name one, you have not looked — go and look.
2. **Every field, with its UNIT spelled out.** "Supplier price" is not a field.
   "Price of ONE carton, with a Carton/Pack pill, echoed as `= X per carton`"
   is a field.
3. **Where does each unit WORD come from?** `sellable_units` and the unit noun.
   Never a hardcoded "pack".
4. **Which existing components and classes?** Never invent an input primitive.

Then **stop and let him answer.** Propose, don't commit.

## 2. One thing at a time

Do not batch five changes and ship them together. Quality measurably dropped at
the end of long batches on 2026-08-05 — that is when the new-product sheet went
out wrong twice.

## 3. Read `app/globals.css` before touching any UI

It holds four palettes (sunrise / aurora / ember / soft, each light AND dark)
in **two different materials** — Soft is carved and opaque where the other
three are glass — plus the Liquid Glass frost dial and Display P3 wide-gamut
tuning for Retina/OLED, including a deliberate carve-out where text colours
were left in sRGB because their contrast was verified on Ali's device in
daylight. None of this is visible from a component file. All of it is easy to
destroy by being helpful.

**The specific way it breaks:** a hardcoded `blur(14px)` or a hand-typed
`box-shadow` looks harmless in review and cannot be reached by any palette, so
Soft silently stops being Soft on that surface. Use `--glass-blur-content`,
`--snm-float-shadow` and `--snm-thumb-shadow`. `npm run audit:material` fails
the build over it — run it, and `npm run audit:ui`, before saying a screen
works.

## 4. Contrast is measured, not judged

`--muted-foreground` on a `--glass-2` sheet measured **~2.6:1** — it fails.
(The token was `#8e9192` when that was measured; it has since been deepened to
`#63676f` light / `#aab0b8` dark, which made it *less bad*, not safe. The rule
is unchanged.) If it has to be read, it is `--foreground`. A field's name never
lives in its placeholder. An unselected pill carrying a choice is content, not
a hint.

**Do not judge this by eye — measure it.** `npm run audit:contrast` composites
the real backdrop through every translucent ancestor and checks 72 cases: 4
palettes × 2 schemes × 9 screens. It has caught failures that were invisible in
`globals.css`, including tab-bar labels failing in all four palettes at once.
Tune a token against the **lightest** surface it can land on — a card inside a
card — never against the page.

## 5. PACKS and CARTONS at every step — buy, receive, sell. Never pieces.

Ali, 2026-08-07, said permanently:

> "For diapers the vendor sells in packs/cartons, we receive packs/cartons and
> we sell packs/cartons. Never in pieces."

**BUY** (what the vendor quotes), **RECEIVE** (what lands and what the GRN
records) and **SELL** (what the customer buys) are all packs and cartons.
There is no step where a diaper is counted in pieces. Earlier versions of this
rule read like a *selling* rule, so the buy and receive sides kept leaking —
the shipment void impact said "26,944 pcs" until migration 0147.

No SKU has `piece` in `sellable_units`. Never offer a selling unit the product
doesn't sell, and quote money in the unit sold. Never ASK for a piece count
either: a field that takes one is as wrong as a label that prints one.
Pieces stay in the database only.

**This is not a UI rule — it covers every word Ali reads.** App screens, chat
replies, analysis, audits, recommendations, PR text. He has now said it five
times; the fourth was after a whole business audit came back to him in
"630 pcs sold" and "7.3 diapers/day", numbers he cannot sanity-check against
his own business. Query in pieces if you must — **convert before it reaches
him**: ÷ `pcs_per_pack` for packs, ÷ (`pcs_per_pack` × `packs_per_carton`)
for cartons, and say which. A rate is "about 2 packs a week", never
"7.3 pieces a day".

## 6. Money and stock math lives in Postgres

Never TypeScript. Stock = SUM(stock_movements). Every SECURITY DEFINER function
gets `SET search_path` and **REVOKE from anon in the same migration**.

## 7. Losing money is a decision, never an accident

Every path that can set a below-cost price stops with the real rufiyaa and an
explicit red confirm. One guard, every door.

## 8. "Merged" is not "live"

A squash-merge to `main` twice failed to trigger a Vercel deploy on 2026-08-05.
Always verify the production deployment reaches READY **and** that
`saynomore-beta.vercel.app` points at it.

---

Full versions with the incident behind each rule: `CLAUDE.md`, `skills.md`.
What is left to do: `docs/HANDOFF.md` **§7, then §11** — §11 is newer and
overrides §7 where they disagree. The two test gates are §10 (money and stock,
173 pgTAP tests) and §12 (the screens, five browser audits).
