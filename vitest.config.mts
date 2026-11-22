import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve the `@/*` alias from tsconfig.json.
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server Components bundle, which
      // tests aren't. Next.js still enforces it in the app.
      "server-only": new URL("./src/test/empty-module.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    // Leave room for the dev server and database on the same machine.
    maxWorkers: "50%",
    // `yarn test:coverage` (E11-1). The thresholds ratchet (decided 28
    // September 2026): a few points below the coverage when they were set.
    // Raise them as tests are added; CI fails when coverage drops below.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/generated/**", "src/test/**", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 86,
        statements: 84,
        functions: 82,
        branches: 78,
        // The domain modules and the AI layer: status, dashboard, file names,
        // schemas, prompts, fact guard, encryption, sessions, rate limiting…
        "src/lib/**": { lines: 94, statements: 92, functions: 90, branches: 83 },
        "src/lib/ai/**": { lines: 94, statements: 92, functions: 92, branches: 81 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "prisma/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
          setupFiles: ["./src/test/setup-ai-fetch.ts"],
        },
      },
      {
        // Tests against a real Postgres database (see src/test/db.ts).
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts", "prisma/**/*.db.test.ts"],
          globalSetup: ["./src/test/db-global-setup.ts"],
          setupFiles: ["./src/test/setup-ai-fetch.ts"],
          // The files share one database, so they run one at a time.
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
