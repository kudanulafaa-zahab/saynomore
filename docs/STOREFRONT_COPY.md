# Storefront copy — everything drafted so far

**Status: drafted in chat, none of it placed into `shop/` yet, none of it
finalized by Ali.** This file exists purely so nothing gets lost or
re-invented across chats. Where Ali hasn't picked between options, that's
noted explicitly — don't guess, ask him.

---

## 1. Hero (top of homepage)

**Headline — pick one (not yet chosen):**
- A) **"Real diapers. Real prices. Delivered."**
- B) **"The genuine article — for less."**
- C) **"Say no more to overpaying for the real thing."**

**Subhead:**
> Genuine MamyPoko, Merries and Sosoft, imported direct — not from wherever
> they happened to wash up. Free delivery across Malé.

---

## 2. Why Say No More (brand story block)

> Every box on this site came through our own supply chain — imported
> directly from MamyPoko and Sosoft's Malaysia and Indonesia distribution,
> the same source your favourite stores would use if they were being
> straight with you about it. No resellers, no "somehow ended up here"
> stock, no guessing where it's really been. Just the genuine product, at a
> genuine price, brought to your door.

Tone note: plain-spoken, a little confident, zero fluff — matches the
"lead with the answer" voice used everywhere else in the app.

---

## 3. Genuine Imports — the MamyPoko colour explainer

Recommended as its own callout card, not buried in a paragraph.

**Headline:** *"Why does MamyPoko look different everywhere?"*

> MamyPoko's packaging isn't one-size-fits-all — it's printed differently
> for every market it's sold in. The dark blue pack you've probably seen
> elsewhere is India's packaging, made for the Indian market. Ours is
> yellow — because we import the version made specifically for Malaysia
> and Indonesia, which is where our stock actually comes from.
>
> Same trusted MamyPoko, formulated and packed for our part of the world —
> not diverted in from somewhere else and sold as if it were local stock.

**Short badge/tooltip version** (for a small label next to the product photo):
> 🟡 Yellow pack = genuine Malaysia/Indonesia import — not the India-market
> (blue) version.

**Deliberate legal note:** this never names or describes other sellers —
it only explains what the colour means. That's the safer and more
convincing way to make the point: we're not accusing anyone, we're just
the seller who bothers to explain it. Keep it that way in any rewrite.

---

## 4. Category intros

**Diapers:**
> Every size, genuinely imported, in stock and ready to go. MamyPoko and
> Merries — the real Malaysia/Indonesia and Japan formulations, not a
> mystery batch.

**Washing Detergent:**
> Sosoft's 2-in-1 wash-and-soften, in five scents — mix and match a full
> carton to your own nose, not ours.

**Brand blurbs already coded** (in `shop/lib/brand-copy.ts`, written from
real published brand facts — Kao/Merries, Unicharm/MamyPoko, Wings/Sosoft
— not copied marketing copy):

> **Merries** — Japan's No.1 diaper brand. A 3-layer Air-Through System
> vents heat and moisture while locking liquid away, and the wavy inner
> sheet cuts skin contact in half. Dermatologically tested, fragrance-free.

> **Mamypoko** — X-tra Kering's X-shaped absorbent core pulls wetness away
> fast for up to 10 hours dry. The gel core expands 40x, with a
> colour-change wetness line so there's no guesswork on when to change.

> **Sosoft** — A 2-in-1 plant-based detergent and fabric softener — first
> in Indonesia to soften with real aloe vera. Five scents to mix and match
> into one carton.

---

## 5. Price comparison — "Compare & Save"

**Headline:** *"Same diaper. Real difference."*
**Subhead:** We checked. Here's what MamyPoko Xtra Kering actually costs
elsewhere in Malé, size for size — priced fairly, per piece, so a bigger
pack can't hide a worse deal.

Real numbers, pulled from Ali's own Market/competitor-price tracking
(logged 2026-07-17) against his current selling prices — not invented:

| Size | Our price / piece | Market price / piece | You save |
|---|---|---|---|
| S | MVR 3.55 | MVR 4.92 | **28% less** |
| M | MVR 4.15 | MVR 5.76 | **28% less** |
| L | MVR 4.74 | MVR 6.40 | **26% less** |
| XL | MVR 5.45 | MVR 8.53 | **36% less** |
| XXL | MVR 6.09 | MVR 10.00 | **39% less** |
| XXXL | MVR 7.96 | MVR 15.45 | **48% less** |

Notes — keep these in mind if this table gets rebuilt or extended:
- Priced **per piece**, not per pack — competitor packs come in different
  counts (their "L" pack is 40 pcs, ours is 42), so pack-price-to-pack-price
  would quietly mislead. Per-piece is the honest comparison.
- The competitor is **not named on the public page** (internally logged as
  "VB" in the Market module) — naming a specific rival in comparative
  pricing is a legal grey area worth avoiding; "market price" makes the
  same point without the risk.
- Only covers MamyPoko Xtra Kering right now — the only line with logged
  competitor prices. Extend to Merries/Sosoft once comparable market data
  exists for them (Ali's team already logs this via the Market module).
- These prices will drift. Either show "prices checked regularly" instead
  of a fixed date (so the page never looks stale), or wire this to refresh
  from live data when it's actually built — not a copy-stage decision.

---

## 6. Delivery & trust

> **Free delivery, every order.** Fast, no minimum spend, no chasing you
> for extra charges at the door. Order in under a minute — no account
> needed. Pay however suits you: cash on delivery, or bank transfer with
> your slip sent straight to us on WhatsApp.

---

## 7. "Why we're cheaper" — affordability / emotional section

Three directions given, **Ali had not picked one as of the last chat.**
Recommendation: **C** for the homepage (earns trust before it earns a
sale), **B** as a punchier pull-quote elsewhere on the page.

**A — closest to Ali's own original draft, tightened:**
> Let's be honest — making it to the end of the month in Malé isn't easy.
> Rent alone eats most of a paycheck before anything else gets a turn, and
> by the time bills and groceries are done, there's rarely much left over.
> Say No More exists because of that math, not despite it. We keep our
> margins honest so your money stretches further — because looking after
> our community matters more to us than squeezing every last rufiyaa out
> of it.

**B — shorter, punchier:**
> Rent first. Bills next. Whatever's left is what you actually get to live
> on — and in Malé, that's never much. Say No More runs on thinner margins
> on purpose, because the alternative is asking you to pay more just so we
> can pad ours. We'd rather earn less and keep you as a customer for years
> than earn more and lose you at the end of the month.

**C — warmer, community angle (recommended for the homepage):**
> We grew up doing the same end-of-month math you're doing right now —
> rent due, salary already spent, groceries still needed. That's exactly
> why Say No More exists. We don't chase the biggest margin on every box;
> we chase being the store your family can actually afford, month after
> month. Fair pricing isn't a promotion here — it's the whole point.

---

## 8. Suggested additions — not yet confirmed by Ali

1. **A real trust stat**, if Ali has one — "X years supplying Malé
   families" or "X+ orders delivered." Never invent a number; get the real
   figure from Ali first, then place it in the hero.
2. **A short "How it works" 3-step strip** (Browse → Order → We deliver)
   above the footer — reduces first-time-buyer hesitation.
3. **A confirmation-screen line** reassuring people their order isn't
   final until a real person confirms it by phone/WhatsApp — sets the
   right expectation given orders land as drafts, not instant purchases.
4. **An "Our Brands" trust strip** near the top (Merries/MamyPoko/Sosoft/
   Kao/Unicharm/Wings names) — recognisable brand names build trust before
   anyone reads a word of copy.
5. Consider **holding off publishing exact savings percentages** until
   there's a routine for re-checking them — a stale "48% cheaper" claim
   sitting for six months is worse than not having the number at all.

---

## Where this fits

This copy is meant to slot into the pages already built in `shop/`
(`app/page.tsx` for hero/brand-story/category intros, a new price-comparison
component, etc.) once Ali picks the options above. See
`docs/STOREFRONT_PLAN.md` → "Next session: in-flight requirements" for the
full build list this copy is part of (hierarchy curation, seasonal
products, mixed-carton checkout, The Body Shop listing).
