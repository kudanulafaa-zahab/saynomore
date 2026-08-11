# Browser audits

Nine scripts that check the app the way Ali does, so he does not have to.

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
npm run audit:ui              # all nine
```

Individually:

```bash
npm run audit:journey                       # all three device sizes
npm run audit:grn                           # receiving, and the landed cost
node scripts/audit/journey.mjs --device phone
npm run audit:material                      # defaults to the Soft palette
npm run audit:contrast                      # all palettes, both schemes
npm run audit:running-costs                 # resets its own fixture first
node scripts/audit/contrast.mjs --palette sunrise
```

Each exits `0` or `1` and prints what failed, with numbers.

**Run the browser audits AFTER `supabase test db`, not before.** The audits place
real orders, receive a real shipment and post real expenses into the same local
database — that is the point of them. The pgTAP suite assumes the pristine
`seed.sql` fixture, so running it afterwards produces failures in
`money_rules` and `post_sale_fifo` that look alarming and are pure pollution.
If you see those two fail, `supabase db reset` and re-run before believing
anything. CI never hits this: `db-tests.yml` and `ui-checks.yml` each start
their own throwaway Postgres.

## What each one checks

**`journey.mjs`** — drives a real sale on phone, tablet and desktop. A mixed
carton and a whole single-colour carton of the same brand stay separate
purchases; a part-filled carton cannot be added; the cart shows a total; no
footer button wraps; the page never scrolls sideways; the docked order rail
appears only on desktop; the add control is never inside a scroller; no piece
count ever reaches the screen; nothing throws.

It also enforces **hard rule 8** — "a new page is not done until it appears in
the menu" — by opening the real More sheet and checking every page in
`nav-config.ts` is listed. That failure is silent by construction: both menus
render only the sections named in `NAV_SECTIONS`, so an item whose section is
missing from that list appears NOWHERE while still type-checking and still
routing. It is how the Price Simulator once shipped built, routable and
invisible. The expected labels are parsed out of `nav-config.ts` itself rather
than copied, because a copy would drift and then assert the wrong thing while
looking green.

**`material.mjs`** — every in-flow surface actually wears the current theme.
Not "does it look nice" — a structural rule that is either true or false: in a
carved palette an in-flow surface is opaque, unblurred, and carries the carve's
two-shadow signature. Floating chrome is exempt, because chrome stays glass by
design. This is what found that the blur had been hand-typed into 22 components
and shadows into 8 more, where no theme could reach them.

**`grn.mjs`** — receives a shipment through the real screen and checks the money
that comes out. This is the biggest calculation in the app: confirming a GRN
apportions freight and local charges by each line's share of CBM, apportions
duty, locks the forex rate permanently, creates the batches and moves the stock
— all at once, and irreversibly. Get it wrong and nothing errors; every landed
cost, margin and price suggestion downstream is simply wrong. The fixture's
shipment has two lines with **different carton sizes** on purpose: a single-line
shipment apportions 100% to itself and proves nothing.

**`offline.mjs`** — records a sale with the network CUT and asserts it was
queued rather than lost, that the screen says so, that the queue drains on
reconnect, and that the order really exists afterwards. This is the failure
mode that costs money and makes no noise, and it has happened here before: an
offline sync bug once meant real cash was recorded and silently never saved.
The queue machinery had been unverified since the day it was written.

**`running-costs.mjs`** — the P&L never claims a profit it cannot support. The
bug it guards was not a crash: `get_pnl` reported **MVR 13,790 "net profit"**
for a month whose running costs were **MVR 0**, in 32px confident green,
because the app modelled rent — identical every month — as a one-off event and
asked for it again every month, so `business_expenses` held ONE row in the
app's whole life. Ali reads his profit here and nowhere else.

The audit asserts both directions. With no operating expenses recorded, the
bottom line must say so plainly, state that the real figure is lower, and offer
the one tap that fixes it; once expenses exist that caveat must disappear and an
Operating Expenses line must appear, or the honest state is just a nag that gets
ignored.

It also **pins the terminology**, in the opposite direction to what you might
expect. An earlier version renamed the line to "Profit before running costs"
when expenses were missing, and paraphrased COGS and Gross Profit into plain
English. Ali, 2026-08-10: *"Don't change the finance or account terms like cogs
net profit etc. you should leave as it is. Always use correct terms where
applicable."* He is right — those are the words his accountant, his bank and
every finance system use, and paraphrasing them leaves him less able to talk to
those people. So the audit now checks that **COGS and Gross Profit are PRESENT**
and that Net Profit is never renamed. The explanation goes beside the term, not
instead of it.

**`wa-links.mts`** — the customer follow-up links never guess a phone number.
Pure logic, no browser, no database, so it runs first. Maldives numbers are
stored as 7 local digits (73 of 74 customers), one already carries `+960`, and
nothing validates what gets typed in. `wa.me` needs a full international
number — so the rule is: recognise the two known shapes, **refuse everything
else**. A wrong number does not fail visibly; it opens a chat with somebody
else and hands them a message meant for a customer. No link is a small
inconvenience; the wrong link is an embarrassing message to a stranger.

**`reorder-nudge.mjs`** — does the app actually ask for the second order? 52 of
73 customers have never bought twice, on a product a household finishes in
about a fortnight (measured: the median pack lasts 6.8 days, a typical order is
2.5 packs). The intelligence already existed and was invisible —
`get_customer_insights` has computed `expected_supply_days` and flagged
`ran_out` for months, behind a lens on the Customers screen you had to know to
open. This checks the whole path: the section appears, names people, says how
long it has been and how long what they bought should have lasted, offers one
tap to WhatsApp with a first-name draft, and "See all" lands on the At risk
lens rather than A–Z. Plus the units rule: no piece count reaches the screen.

It back-dates the fixture customer's order by **400 days**, not 45. The first
version used 45, passed alone, and failed when run after `journey` and
`offline` — those place extra orders for the same customer, so their last order
grows and 45 days stops exceeding its supply. **An audit whose result depends on
which audits ran before it is not a check, it is a coin toss.**

**`direct-receipt.mjs`** — stock bought locally or carried in can be received,
and reads right afterwards. Ali carried a few dozen Body Shop body butters home
in his baggage; there was one door into stock (shipment → GRN → freight split
by CBM) and `shipment_lines` requires CBM > 0, so they could not be entered at
all. Beyond "the form works", this watches the things that go quietly wrong:
the screen asks in the **product's own unit** ("How many tubs"), the total is
echoed back **before** committing (a mistyped unit cost silently becomes the
cost basis of every future sale from that batch), the confirm says what it will
NOT do, and Inventory afterwards reads "24 tubs" — never "24 packs" and never a
piece count.

That last check found a real bug while it was being written: **three** places
knew what a unit is called — Postgres `unit_noun`, `lib/trade-units`
`containerLabel`, and a private copy inside `inventory-view` — so the same 24
tubs read "24 ctn" on the brand rollup while the database called them tubs.

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
| offline writes dropped instead of queued | offline — "the sale was not queued" |
| freight split evenly per line instead of by CBM | grn — both landed costs wrong by 584/carton |
| generator changed to `DO UPDATE` (a corrected month silently reverted) | pgTAP `recurring_expenses` — 3 tests, incl. "a hand-corrected month SURVIVES regeneration" |
| brand revenue in the P&L drill-down halved, so the parts no longer sum to the total | running-costs — "the brand breakdown adds up to the Revenue total exactly" |
| the hardcoded `"ctn"` put back on the Inventory brand rollup | direct-receipt — "Inventory shows 24 tubs" |
| a section removed from `NAV_SECTIONS`, hiding its pages from both menus while they still type-check and still route | journey — "every page is in the menu (missing: Products, Customers)" |
| `waNumber` falling back to the raw digits instead of refusing an unknown shape — the "helpful" version that messages a stranger | wa-links — 4 checks, incl. "a foreign number -> NO GUESS" |

**One mutation attempt was a no-op and is worth recording**, because stopping
there would have bought false confidence. The first attempt at breaking the
drill-down dropped the *first* brand group (`brandGroups.slice(1)`) — and the
audit stayed green, correctly: the dropped brand had no sales in the fixture
period, and the component already filters zero-value groups out. Nothing had
actually changed. The real mutation had to remove value that was genuinely
there (`g.revenue * 0.5`). **A mutation that does not change behaviour proves
nothing about the check — only about the mutation.**

Two earlier mutation attempts were **not** caught, and that was correct: each
had a second fix covering it, so neither was still a regression. Worth knowing
before trusting a green run — and worth re-checking whenever a rule changes.

## Adding a check

Put it where it belongs: a money or stock rule belongs in
`supabase/tests/database/`, not here. These are for what a person sees. Prefer
one clear assertion with a number in its failure message over a screenshot
comparison — Ali reads the failure, and "3.84:1 needs 4.5" tells him something
that a diff image does not.
