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
    // The clickable prototype and its vendored runtime, kept for reference.
    "design/**",
    // The HTML coverage report from `yarn test:coverage`.
    "coverage/**",
    // The website, as site/build.sh puts it together.
    "_site/**",
    // End-to-end test output.
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
