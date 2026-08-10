# Browser audits

Three scripts that check the app the way Ali does, so he does not have to.

## Why these exist

The money and stock half of SayNoMore has 170+ pgTAP tests and has not produced
an incident in months. The screens had nothing — every UI defect in August was
found by Ali, on his phone, **after it shipped**:

| What he said | What it was |
|---|---|
| "What's this big + sign?" | two controls doing the same job, one unlabelled |
| "the +add more is scrolling" | an add control living inside a scrolling list |
| "1.6666666666666667 cartons" | bottles vanishing when two lines merged |
| "7 bottles blue" | a whole carton and a mixed carton merged into one line |
| a phone screen stretched to 1512px | no layout of its own above phone width |
| grey text you cannot read | 2.8:1 against the card it was printed on |

Same app, two halves, one difference: one half checks itself.

## Running them

You need the local stack up — Docker, `supabase start`, and the app running.

```bash
supabase start                # replays every migration onto a fresh Postgres
npm run audit:seed            # fixture data + an admin sign-in
npm run dev                   # or: npm run build && npm run start
npm run audit:ui              # all three
```

Individually:

```bash
npm run audit:journey                       # all three device sizes
node scripts/audit/journey.mjs --device phone
npm run audit:material                      # defaults to the Soft palette
npm run audit:contrast                      # all palettes, both schemes
node scripts/audit/contrast.mjs --palette sunrise
```

Each exits `0` or `1` and prints what failed, with numbers.

## What each one checks

**`journey.mjs`** — drives a real sale on phone, tablet and desktop. A mixed
carton and a whole single-colour carton of the same brand stay separate
purchases; a part-filled carton cannot be added; the cart shows a total; no
footer button wraps; the page never scrolls sideways; the docked order rail
appears only on desktop; the add control is never inside a scroller; no piece
count ever reaches the screen; nothing throws.

**`material.mjs`** — every in-flow surface actually wears the current theme.
Not "does it look nice" — a structural rule that is either true or false: in a
carved palette an in-flow surface is opaque, unblurred, and carries the carve's
two-shadow signature. Floating chrome is exempt, because chrome stays glass by
design. This is what found that the blur had been hand-typed into 22 components
and shadows into 8 more, where no theme could reach them.

**`contrast.mjs`** — every readable word, every palette, both schemes, measured
on the **rendered page**. It composites the real backdrop through every
translucent ancestor, because a token's colour tells you nothing until you know
what is painted behind it: the muted grey that measures fine against the page
failed at 2.81:1 against the *cards* it is actually printed on, and the tab bar
composites lighter than the page and failed the nav labels in all four palettes
at once. Neither was findable by reading `globals.css`.

## They are proven to fail

A check that cannot fail is worse than none — it manufactures confidence. Each
was verified by putting its bug back:

| Mutation | Caught by |
|---|---|
| dark `--muted-foreground` back to `#8e9192` with `--tabbar-fg` removed | contrast — 3.84:1 on every dark screen |
| a hardcoded `blur(14px)` on the sales card | material — "BLUR on in-flow content", 3 elements |
| an "Add more" button back inside the cart | journey — failed on all three device sizes |

Two earlier mutation attempts were **not** caught, and that was correct: each
had a second fix covering it, so neither was still a regression. Worth knowing
before trusting a green run — and worth re-checking whenever a rule changes.

## Adding a check

Put it where it belongs: a money or stock rule belongs in
`supabase/tests/database/`, not here. These are for what a person sees. Prefer
one clear assertion with a number in its failure message over a screenshot
comparison — Ali reads the failure, and "3.84:1 needs 4.5" tells him something
that a diff image does not.
