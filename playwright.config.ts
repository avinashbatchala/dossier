import { defineConfig, devices } from "@playwright/test";

import { APP_PORT, appEnv, FAKE_AI_PORT, FAKE_GOOGLE_PORT, FAKE_JOBS_PORT, STORAGE_STATE } from "./e2e/support";

// End-to-end tests (E11-2): a production build (`yarn build` first) with its
// own database, a fake AI server and fake job sources, in headless Chromium.
// See DEVELOPMENT.md → "End-to-end tests".
export default defineConfig({
  testDir: "e2e",
  // One database, so one test at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1400, height: 900 },
  },
  projects: [
    { name: "setup", testMatch: /setup\.ts$/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 }, storageState: STORAGE_STATE },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: "node e2e/fake-ai.mts",
      url: `http://localhost:${FAKE_AI_PORT}/health`,
      env: { FAKE_AI_PORT: String(FAKE_AI_PORT) },
      reuseExistingServer: false,
    },
    {
      command: "node e2e/fake-jobs.mts",
      url: `http://localhost:${FAKE_JOBS_PORT}/health`,
      env: { FAKE_JOBS_PORT: String(FAKE_JOBS_PORT) },
      reuseExistingServer: false,
    },
    {
      command: "node e2e/fake-google.mts",
      url: `http://localhost:${FAKE_GOOGLE_PORT}/health`,
      env: { FAKE_GOOGLE_PORT: String(FAKE_GOOGLE_PORT) },
      reuseExistingServer: false,
    },
    {
      // The standalone server, as in the production image, with the static
      // files it doesn't copy itself.
      command:
        "yarn prisma migrate deploy && cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/ && node .next/standalone/server.js",
      url: `http://localhost:${APP_PORT}/login`,
      env: { ...appEnv(), HOSTNAME: "127.0.0.1" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
