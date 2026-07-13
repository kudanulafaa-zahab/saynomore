# START HERE — SayNoMore, current source of truth

_Last verified: 2026-07-13. If a memory note or an old file disagrees with THIS
file, this file wins — it is checked against live git/Supabase/Vercel below._
_Read this first, then `CLAUDE.md` + `skills.md`._

---

## The app
An **installed iOS PWA** for an FMCG import/distribution business in the Maldives.
Owner: **Ali** (non-technical, runs the business daily from his iPhone).
Full flow: 7-level SKU hierarchy → purchase order → shipment with CBM landed-cost
engine → GRN receipt → tier-priced sales orders → FIFO depletion → dispatch/COD →
payments → P&L / reports.

## Exact coordinates (verified live, 2026-07-13)
- **Live app (the PWA):** https://saynomore-beta.vercel.app
  ← this is Ali's exact installed app. Verify every change here.
- **Login:** account **kudanulafaa@gmail.com**.
  🔒 Password is NOT stored in this repo (it is public). It lives in Ali's
  password manager. Never commit it here or anywhere in git.
- **GitHub:** `kudanulafaa-zahab/saynomore` (PUBLIC repo). Default branch `main`.
- **Active dev branch:** `claude/saynomore-handoff-n1e3du` (ff-merged into `main`).
- **Supabase:** project ref `smhdwkrmiytvpsgqezsl` · name `saynomore` ·
  org `yzyphsswhzbdhjbwqxlq` · URL https://smhdwkrmiytvpsgqezsl.supabase.co
  (Claude is authorized to apply migrations directly to this production project.)
- **Vercel:** project `saynomore` · team `kudanulafaa-zahabs-projects`
  (`team_qyYXhgTXNYb5dCxNgfIMmQxk`). `main` auto-deploys to the live URL above.
- **Stack:** Next.js 16.2.4 (App Router + Turbopack, React Compiler on), React 19,
  TypeScript strict, Tailwind v4, Supabase (Postgres + RLS). npm package name is
  `saynomore-ali`.

## Working folder (environment-dependent — the GitHub repo is the constant)
- **Desktop (Claude app on Windows):** `C:\Users\futurehomes\Desktop\Claude APP\saynomore-ali`
  — this is the canonical local checkout. If a sibling `saynomore` folder exists,
  ignore it; use `saynomore-ali`.
- **Claude Code on the web:** each session clones fresh to its own path
  (e.g. `/home/user/saynomore`). That's normal and correct — it's the same
  GitHub repo. Trust `git remote -v` + `git log origin/main`, not the folder name.

## Latest state on `main` (as of this file)
Tip includes, newest first: **HANDOFF (this)** · luminous glass design language
(atmospheric `--app-bg` + `--glass-sheen`, no per-card blur) · dispatch
"Completed Today" fix (bounded to Maldives midnight) + dashboard greeting header ·
light-mode deep-emerald success `#0E6E33` · graphite accent · chrome overhaul
(large titles, floating glass tab bar) · business intelligence (receivables aging,
expiry tracking, Promo Advisor, morning briefing, campaign ROI) · office/driver
notifications · Market/Expenses restructure. All deployed READY to the live URL.

⚠️ If a session ever reports the "last commit" as `d17bde0` ("Perf: fix dispatch
N+1…"), it is **~24 commits stale**. Fix it: `git fetch origin && git reset --hard
origin/main`, then re-read this file. Do NOT let a stale checkout force-push.

## Open / needs Ali's eyes on the phone
1. **Glass depth is unverified on the real device.** Deliberately subtle. Too
   strong or too faint? Tune ONE place: `--app-bg` + `--glass-sheen` (light AND
   dark blocks) in `app/globals.css`. Nothing else.
2. **Light-green sweep:** deepened at the token level (one `--snm-success`), but
   Ali asked to check every module by screenshot. **Dark-mode green must NOT
   change — Ali approved it.**
3. **Refined Data Viz** (per-module KPI typography hierarchy, chart restyle) is
   the next design layer — component-by-component, not yet done.

## Working with Ali's iPhone (the QA channel)
- Ali's **screenshots are the bug reports** — trace each to a line of code.
- **Self-verifying live from inside a container is gated by the environment's
  network policy.** If a session can't reach `saynomore-beta.vercel.app` or
  Supabase to log in, that policy must allow those domains; otherwise fall back
  to `tsc`/`build` + Ali's screenshots. Never claim a mobile fix works without a
  screenshot or live access — say plainly when you couldn't verify.

## Publish flow (every confirmed change)
`commit → git push -u origin <branch> → git checkout main → git merge --ff-only →
git push origin main → confirm Vercel READY at the live URL`. Supabase migrations:
file in `supabase/migrations/NNNN_*.sql` AND apply live via MCP in the same work
unit; REVOKE anon on every new SECURITY DEFINER fn in the same migration; run
advisors after DDL.

## Talking to Ali
Plain English, lead with the answer, ONE recommendation, rufiyaa before
percentages, never make him choose between technical options.
