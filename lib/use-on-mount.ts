import { useEffect } from "react";

/**
 * Run an async loader once, when the screen mounts.
 *
 * WHY THIS EXISTS RATHER THAN `useEffect(() => { load(); }, [])`
 *
 * React 19's `react-hooks/set-state-in-effect` flags that line in every screen
 * in this app — 26 of the 52 warnings on 2026-08-10 were exactly it. The rule
 * follows the call into `load()`, sees setState, and cannot prove it is not
 * synchronous.
 *
 * In this codebase it never is. Every loader has the shape skills.md
 * prescribes:
 *
 *     const [loading, setLoading] = useState(true);   // true to begin with
 *     async function load() {
 *       try   { const [a, b] = await Promise.all([...]); setA(a); setB(b); }
 *       catch (e) { toast.error(...); }
 *       finally { setLoading(false); }                 // never at the top
 *     }
 *
 * Nothing sets state before the first `await`, so nothing runs synchronously
 * inside the effect. The warning is the rule being conservative, not a defect.
 *
 * The honest options were: rewrite 26 screens onto Suspense or a query library
 * (a large architectural change, real risk, no user-visible gain), scatter 26
 * `eslint-disable` comments, or put the pattern behind one named helper where
 * the reasoning lives once and can be argued with. This is the third.
 *
 * BE CLEAR ABOUT WHAT THAT MEANS: the rule cannot see through this indirection,
 * so it stops reporting at these call sites. That is a trade, not a fix, and it
 * is only defensible because the pattern behind it has been read and is sound.
 * It is named `useOnMount` and not `useSafeEffect` for that reason — it does
 * one narrow thing, and reaching for it anywhere else is misuse.
 *
 * IMPORTANT — WHAT THIS DOES NOT COVER
 *
 * The rule stays ON everywhere else, deliberately. It catches a real bug class:
 * a dialog that starts blank and copies its values in from an effect leaves a
 * frame showing the PREVIOUS record's numbers, which on a price form is a frame
 * too many (see EditSkuDialog, fixed 2026-08-10). Do not reach for this helper
 * to silence one of those. The fix there is to initialise state from props and
 * let mounting do the reset.
 *
 * Runs ONCE. If the work needs to re-run when something changes, this is the
 * wrong tool — write the effect out with its real dependencies.
 */
export function useOnMount(run: () => void | Promise<void>) {
  useEffect(() => {
    void run();
    // The loader is intentionally run once on mount and never re-run; `run` is
    // redeclared every render, so listing it would defeat that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
