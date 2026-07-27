import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // ── react-hooks/set-state-in-effect: WARN, deliberately ───────────────
      // This is the React Compiler's PERFORMANCE advisory ("can hurt
      // performance... is not recommended"), not a correctness rule. It fires on
      // two patterns this app uses intentionally, ~55 times across ~30 screens:
      //
      //   1. Data loaders — `useEffect(() => { load(); }, [])`, where load()
      //      fetches and then sets state. This is the standard client-component
      //      fetch pattern; the app's own convention (skills.md) is initial
      //      state `true` with `setLoading(false)` in `.finally`, so a refetch
      //      swaps in place. Verified empirically: following that convention
      //      does NOT clear the rule — it traces into any called function and
      //      cannot see the async boundary. Clearing it would mean restructuring
      //      the loading effect of every money screen (sales, dispatch,
      //      shipments, products, financials) with no way to device-test them.
      //   2. Dialog form-sync — populating fields when a dialog opens with a
      //      record. skills.md explicitly parks these: "pre-existing dialog
      //      form-sync warnings are known and parked pending click-testing —
      //      don't blind-refactor money dialogs."
      //
      // Neither is a bug, and contorting working money code to silence an
      // advisory lint would risk exactly what the rule exists to protect. Kept
      // as a WARN so it stays visible and new code can be written the better
      // way, without failing the build on the existing, working pattern.
      //
      // Genuinely fixable instances were FIXED, not suppressed: mounted flags
      // now use `useMounted()` (useSyncExternalStore — the pattern skills.md
      // sanctions) in BodyPortal, Sheet and the mobile SKU sheet.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
