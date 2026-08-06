# The prompt to start a new chat with

Ali: paste the block below into a fresh chat. Nothing else is needed — it is
deliberately short enough to type from a phone if you ever lose it.

---

```
Read docs/HANDOFF.md in full before doing anything, then app/globals.css
before touching any UI. Start with section 7 (what's left), 5L (everything
done on 2026-08-05), 2b (every screen) and 3 (the design system).

Treat HANDOFF as a map, not the record — the record is globals.css, the
migration headers, skills.md and git log. If they ever disagree, git wins.

Then tell me what you think is left to do and what you'd do first. Don't
start building until I answer.
```

---

## Why it is written this way

- **"in full"** — a new session will otherwise skim. The file is 1,200 lines
  and the parts that matter most are not at the top.
- **"then `app/globals.css` before touching any UI"** — this is the one that
  protects the work that is easiest to destroy by accident: four palettes
  (sunrise / aurora / ember / monochrome, each light and dark), the Liquid
  Glass frost dial, the Display P3 wide-gamut tuning for Retina, and a
  deliberate carve-out where text colours were left in sRGB because their
  contrast was verified on Ali's device in daylight. None of that is visible
  from a component file.
- **"map, not the record… git wins"** — a summary can go stale or thin. The
  code and the migration headers cannot. This sentence stops a new session
  trusting a paraphrase over the source.
- **"Don't start building until I answer"** — the single most useful line.
  Every complaint Ali has raised traces to building before reading. Making the
  first turn a *proposal* rather than a *commit* is what catches it.

## Two habits worth keeping, whatever the chat

1. **Before any new screen, ask: "which existing screen is this copied from?"**
   A filename means the work was done. Reasoning instead of a filename means it
   was not. The full four-line gate is in `CLAUDE.md`.
2. **One thing at a time.** Quality dropped measurably at the end of long
   batches on 2026-08-05. "Field list first, then build" costs a minute and
   saves a rebuild.

## Start a fresh chat when

- Replies start missing things you have already said, or
- the same mistake gets made twice, or
- you have been going for a few hours.

Nothing is lost by doing it. Everything is committed.
