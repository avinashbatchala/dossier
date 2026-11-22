import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // SQLite has no skipDuplicates, and the PostgreSQL client's types used for
    // both don't catch it (see SQLite in DEVELOPMENT.md).
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='skipDuplicates'], Property[key.value='skipDuplicates']",
          message: "SQLite doesn't support skipDuplicates: remove the duplicates first, or upsert.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The clickable prototype and its vendored runtime, kept for reference.
    "design/**",
    // The HTML coverage report from `yarn test:coverage`.
    "coverage/**",
    // The website, as site/build.sh puts it together.
    "_site/**",
    // The desktop app's dependencies and what it builds.
    "desktop/dist/**",
    "desktop/build-server/**",
    "desktop/build-input/**",
    "desktop/release/**",
    "desktop/**/node_modules/**",
    "desktop/**/test-results/**",
    // End-to-end test output.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
