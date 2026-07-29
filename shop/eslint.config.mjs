import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    rules: {
      // Same call as the main app (see its eslint.config.mjs): this is the
      // Compiler's performance advisory for loader-effect and client-storage-
      // hydration patterns this app uses intentionally (catalogue fetch on
      // mount, cart/platform read from localStorage/UA on mount) — not a
      // correctness bug. Kept visible as a warning rather than silenced.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
