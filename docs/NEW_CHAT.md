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

## You do not have to remember anything else

Ali, 2026-08-05: *"I can't remember to ask these two everytime. It's
impossible to remember."* Correct — and asking you to remember was the same
mistake, just pointed at you. It is now mechanical.

`.claude/settings.json` carries a **SessionStart hook** that injects
`.claude/session-rules.md` into every new session automatically, before the
first word is typed. It fires whether or not you paste the prompt above,
whether or not you remember it exists. The rules it injects:

1. Output the four-line field list before writing ANY UI, then stop and wait.
2. One thing at a time — no five-change batches.
3. Read `app/globals.css` before touching any UI.
4. Contrast is measured, not judged.
5. Packs and cartons, never pieces.
6. Money and stock math in Postgres, anon revoked.
7. Below-cost needs an explicit decision, on every door.
8. "Merged" is not "live" — verify the deploy.

**Your only job is to notice when a reply proposes UI without the four lines
in front of it.** Recognising something missing is far easier than remembering
to ask for it, and if it is missing you can just say *"field list?"*

To read or change what gets injected, edit `.claude/session-rules.md`. To turn
it off, delete the `hooks` block from `.claude/settings.json`.

## Start a fresh chat when

- Replies start missing things you have already said, or
- the same mistake gets made twice, or
- you have been going for a few hours.

Nothing is lost by doing it. Everything is committed.
