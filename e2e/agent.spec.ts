import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The job agent end to end: one search, scored by the fake AI, one tailored
// draft, and the manual run limit. It never sends.

const query = JSON.stringify({
  keywords: "designer",
  place: "",
  country: "nl",
  radiusKm: 25,
  remoteOnly: false,
  postedWithin: "any",
});

test.beforeEach(async () => {
  await resetData();
  const ranAnHourAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  const settings: [string, string][] = [
    ["agentEnabled", "true"],
    ["agentQuery", query],
    ["agentHour", "23"],
    ["agentMinScore", "70"],
    ["agentMaxScores", "3"],
    ["agentMaxDrafts", "1"],
    ["agentAutoDraft", "true"],
    ["agentLastRunAt", ranAnHourAgo],
  ];
  for (const [key, value] of settings) {
    await sql(
      `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [key, value],
    );
  }
});

test("runs, prepares one draft, and never sends it", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.getByRole("heading", { name: "Job agent" })).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();

  await expect(page.getByRole("link", { name: "Review draft" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const [row] = await sql<{ count: string }>(`SELECT count(*)::text AS count FROM "Application" WHERE origin = 'AGENT'`);
    return row.count;
  }).toBe("1");

  const [application] = await sql<{ id: string; status: string; origin: string; sentAt: string | null; emailThreadId: string | null }>(
    `SELECT id, status, origin, "sentAt", "emailThreadId" FROM "Application" WHERE origin = 'AGENT'`,
  );
  expect(application).toMatchObject({ status: "DRAFT", origin: "AGENT", sentAt: null, emailThreadId: null });
  expect(Number((await sql<{ count: string }>(`SELECT count(*)::text AS count FROM "EmailMessage"`))[0].count)).toBe(0);

  // The same hourly limit applies to the next manual run.
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/The agent ran recently/)).toBeVisible();

  await page.getByRole("link", { name: "Review draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/${application.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: /Senior Product Designer/ })).toBeVisible();
});
