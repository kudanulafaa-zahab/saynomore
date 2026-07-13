# SESSION HANDOFF — SayNoMore

_Last updated: 2026-07-13 · read this first, then `CLAUDE.md` + `skills.md`._

## How to read this repo
- `CLAUDE.md` = hard rules (money math in Postgres, publish flow, key paths).
- `skills.md` = the design/engineering laws with the incident behind each one.
  **These win over any fresh idea unless Ali overrules.**
- This file = live status + how to work with Ali's iPhone.

## Where things stand (all LIVE in production, verified READY on Vercel)
Branch: `claude/saynomore-handoff-n1e3du` → ff-merged to `main`. Latest commits:
- `42f4689` — **Luminous glass design language.** Atmospheric page gradient
  (`--app-bg`, painted by `body::before`, one fixed GPU layer, neutral
  luminance only) behind translucent cards + specular sheen (`--glass-sheen`)
  + 1px inner hairline. NO per-card backdrop-blur (that was the old scroll-lag
  cause). Light/dark share identical DNA. skills.md law updated to sanction it.
- `5274c5c` — **Dispatch "Completed Today" bug + dashboard heading.**
  `listAllDispatchOrders()` used to pull *all* delivered orders ever and dump
  them under "Completed Today"; now bounded to since-midnight Maldives time
  (helper `mvtStartOfTodayISO` in `lib/queries/sales.ts`). Dashboard now opens
  with a time-aware greeting header (`app/(app)/dashboard/page.tsx`).
- `c5bfef3` — light-mode deep-emerald success `#0E6E33` (old `#248A3D` measured
  3.94:1, below AA); one-colour-per-sales-row; Log Price moved off the content
  into the Market header.

## Open / needs Ali's eyes on device
1. **Glass intensity is unverified on the real phone.** The atmospheric depth
   is deliberately subtle. If it reads too strong or too faint in Maldivian
   daylight, tune it in ONE place: `--app-bg` (light + dark blocks) and
   `--glass-sheen` in `app/globals.css`. Nothing else needs touching.
2. **System-wide light-green audit** was done at the token level (one
   `--snm-success` change deepens everything), but Ali asked to "look at
   everything" — worth a screenshot pass across every module to confirm no
   pale-green survives in an inline usage. **Dark-mode green must NOT change
   (Ali approved it).**
3. The glassmorphic restyle so far lives at the token layer, so it hit every
   `.snm-card`/`.glass` at once. If Ali wants per-module refinement (KPI card
   typography hierarchy, chart restyle — "Refined Data Viz"), that's the next
   layer of work and is component-by-component.

## Working with Ali's iOS device (the QA channel)
- Ali runs the business from an **installed iOS PWA**. His **screenshots are
  the bug reports** — treat each as evidence and trace it to a line of code.
- **Live self-verification from inside the container was blocked last session**
  by the environment network policy (couldn't reach the production URL or
  Supabase to log in). If live verification matters this session, that policy
  needs to allow the app domain + Supabase; otherwise fall back to: build/tsc
  locally + Ali's screenshots. Ali holds the app login — do not store it here.
- Production URL is the Vercel project `saynomore`
  (team `kudanulafaa-zahabs-projects`). Never claim a mobile fix works without
  either a screenshot from Ali or live access — say plainly when you couldn't
  verify and what would unlock it.

## Publish flow (every confirmed change)
`commit → git push -u origin <branch> → git checkout main → git merge --ff-only
→ git push origin main → confirm Vercel deploy READY`. Supabase changes go live
immediately via MCP (migrations: file in `supabase/migrations/NNNN_*.sql` AND
apply live in the same work unit; run advisors after DDL; REVOKE anon on every
new SECURITY DEFINER fn in the same migration).

## Talking to Ali
Plain English, lead with the answer, ONE recommendation, rufiyaa before
percentages, never make him choose between technical options.
