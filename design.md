# SayNoMore — Design System (Type & Legibility)

**Authority:** This repo's own `app/globals.css` iOS type tokens + Apple Human Interface
Guidelines (iOS 26 "Liquid Glass"). No external design doc supersedes these. Do **not**
use `skills.md` or the `ui-ux-pro-max` skill for type decisions — this file is the source
of truth for typography.

**Why this exists:** The app is used one-thumb in a Maldives godown / on a delivery bike,
often in bright daylight. On phones, data and figures were rendering too small for
comfortable field use because components hardcoded `text-[11px]/[12px]/[13px]` — Apple
*caption* sizes — for the DATA and VALUES people actually read, not just for tiny labels.
The fix is to enforce the token scale below and stop hardcoding caption-size pixels on data.

---

## 1. The iOS type scale (already in `app/globals.css`)

Each token has a matching `-lh` (line-height) and `-ls` (letter-spacing) var, and a ready
`.ios-*` utility class. Use the utility class; never re-declare these sizes inline.

| Token / class      | Size | Apple style   | Use for                                                    |
|--------------------|------|---------------|------------------------------------------------------------|
| `.ios-large-title` | 34px | Large Title   | Rare hero numbers only                                     |
| `.ios-title1` / `.ios-page-title` | 28px | Title 1 | **Every page heading** (use `.ios-page-title`)   |
| `.ios-title2`      | 22px | Title 2       | Section headers, big card totals                           |
| `.ios-title3`      | 20px | Title 3       | Sub-section headers                                        |
| `.ios-headline`    | 17px | Headline      | Emphasised body / primary row title (semibold)             |
| `.ios-body`        | 17px | Body          | **Default body text**                                      |
| `.ios-callout`     | 16px | Callout       | Slightly reduced body in dense rows                        |
| `.ios-subhead`     | 15px | Subheadline   | **Minimum size for any DATA / VALUE / secondary body**     |
| `.ios-footnote`    | 13px | Footnote      | True footnotes / helper text under a field                 |
| `.ios-caption1`    | 12px | Caption 1     | **True captions**: uppercase labels, pill text, meta       |
| `.ios-caption2`    | 11px | Caption 2     | Micro-labels only (pill overlines, badge counts)           |

## 2. The rule that fixes legibility

> **Data and values are never caption-sized.**

- **Data / values / secondary body** (prices, MVR figures, quantities, product names,
  codes, counts, dates, notes, list-row subtitles) → **minimum 15px** → `.ios-subhead`
  (or larger: `.ios-callout` 16 / `.ios-body` 17 for primary text). **Never** `text-[11/12/13px]`.
- **True captions** (UPPERCASE section labels, pill/badge text, field overlines, meta
  like "3 items") → `.ios-caption1` (12px) or `.ios-footnote` (13px) for helper text.
  Keep these small — they are correctly caption-sized.
- **Body** → `.ios-body` (17px).
- **Page titles** → `.ios-page-title` (28px).

**Decision test:** *"Would a user squint to read this number/word to do their job?"*
If yes → it's data → **≥15px**. If it's just a shouted UPPERCASE label or a badge → caption.

**Controls are the one exception to "bigger is better."** Button / pill / segmented-control
*labels* stay at **14px** (Tailwind `text-sm`, semibold) — that is Apple's correct control
size, and enlarging it blows out button widths. So:
- **Button / capsule / tab labels** (`snm-btn`, `snm-glass-btn`, or a rounded+interactive+
  padded pill) → keep **14px** `text-sm`. Do **not** bump.
- **Form inputs / textareas / selects** → **15px** `.ios-subhead` (typed data must be
  legible — an input is data you read back, not a control label).
- Everything else that is data/body → **≥15px** per the rule above.

## 3. What "hardcoded" means (and why to stop)

Do **not** write `text-[11px]`, `text-[12px]`, `text-[13px]`, or inline
`style={{ fontSize: … }}` on data. These bypass the scale, so a global type bump can't
reach them and they drift out of the system. Use the `.ios-*` class instead:

```diff
- <p className="text-[13px] font-semibold text-foreground">{o.order_number}</p>
+ <p className="ios-subhead font-semibold text-foreground">{o.order_number}</p>

- <p className="text-[12px] text-muted-foreground">{r.internal_code}</p>
+ <p className="ios-subhead text-muted-foreground">{r.internal_code}</p>
```

UPPERCASE labels stay caption-sized — leave them:

```jsx
<p className="label-caps text-[12px] ...">PURCHASE ORDER</p>   {/* true caption — OK */}
```

## 4. Applying it safely (learned watch-outs)

- Bumping sizes bluntly can cause **truncation / wrap / blown-out glass cards** across
  screens. After a bump, verify layouts on phone-width preview (375px). Add `truncate`
  or `min-w-0` where a row now overflows rather than reverting the size.
- **Desktop density must stay unaffected.** The `.ios-*` classes are the same on every
  viewport; this pass raises the *floor* for data (12/13→15). It does not add desktop-only
  shrinking. Don't introduce responsive down-sizing that reads data below 15px on mobile.
- **Never `100vh`** (CLAUDE.md scroll rule) — full-screen layers use `100dvh`.
- Keep light/dark contrast; `--snm-success`/`--snm-warning` are already tuned for 4.5:1.
- Dev server can serve **stale modules** — clear `.next/cache` + restart preview to see
  type changes.

## 5. Non-type tokens (reference)

Colours are CSS vars only — never hardcode hex. Cards: `var(--glass-1)` +
`backdrop-filter: var(--glass-blur)` + `var(--glass-border)`. Radii use
`.snm-radius-container` (20) / `.snm-radius-inner` (14) / `.snm-radius-tight` (10).
Full token set lives in `app/globals.css`; this file governs **type** specifically.
