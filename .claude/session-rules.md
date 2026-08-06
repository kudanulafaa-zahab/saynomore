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

It holds four palettes (sunrise / aurora / ember / monochrome, each light AND
dark), the Liquid Glass frost dial, and Display P3 wide-gamut tuning for
Retina/OLED — including a deliberate carve-out where text colours were left in
sRGB because their contrast was verified on Ali's device in daylight. None of
this is visible from a component file. All of it is easy to destroy by being
helpful.

## 4. Contrast is measured, not judged

`--muted-foreground` (#8e9192) on a `--glass-2` sheet is ~2.6:1 — it fails.
If it has to be read, it is `--foreground`. A field's name never lives in its
placeholder. An unselected pill carrying a choice is content, not a hint.

## 5. Diapers sell in PACKS and CARTONS. Never pieces.

No SKU has `piece` in `sellable_units`. Never offer a selling unit the product
doesn't sell, and quote money in the unit sold. Pieces stay in the database
only.

**This is not a UI rule — it covers every word Ali reads.** App screens, chat
replies, analysis, audits, recommendations, PR text. Ali has said it four
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
What is left to do: `docs/HANDOFF.md` §7.
