import { expect, test } from "@playwright/test";

import { fakeJobSearches, resetData, sql } from "./support";

// The job agent end to end (E16): turned on in Settings, run now against the
// fake JSearch and the fake AI, a draft prepared and approved, a posting
// dismissed, and a second run that brings none of them back.
test.beforeAll(resetData);
// Off again, so its timer leaves the other specs alone.
test.afterAll(async () => {
  await sql(`DELETE FROM "Setting" WHERE key LIKE 'agent%'`);
  await sql(`DELETE FROM "AgentCandidate"`);
});

const card = (page: import("@playwright/test").Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: title }) });

test("finds, scores, drafts and dismisses, and never brings a posting back", async ({ page }) => {
  await page.goto("/settings?section=agent");
  await page.getByLabel("What").fill("Product designer");
  await page.getByLabel("Country").selectOption("nl");
  await page.getByRole("switch", { name: "Run the job agent" }).click();
  await expect(page.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("All changes saved")).toBeVisible();

  // Run now: one search, three postings scored, two in the queue.
  const searches = await fakeJobSearches();
  await page.getByRole("link", { name: "Agent", exact: true }).click();
  await expect(page).toHaveURL("/agent");
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("2 new postings are waiting for a look.").first()).toBeVisible({ timeout: 30_000 });
  expect(await fakeJobSearches()).toBe(searches + 1);
  const scored = page.getByRole("region", { name: "Scored postings" });
  await expect(scored.getByRole("heading", { level: 3 })).toHaveText(["Senior Product Designer, Payments", "Product Designer, Logistics"]);
  await expect(card(page, "Senior Product Designer, Payments").getByRole("img", { name: "Score 91 of 100" })).toBeVisible();
  // The one below the minimum score waits behind Show.
  await expect(page.getByText("UX Designer")).toHaveCount(0);
  await page.getByRole("button", { name: "1 below your minimum score of 70 · Show" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "UX Designer" })).toBeVisible();

  // Prepare a draft: it waits for review, out of Applications.
  await card(page, "Senior Product Designer, Payments").getByRole("button", { name: "Prepare draft" }).click();
  const drafts = page.getByRole("region", { name: "Drafts to review" });
  await expect(drafts.getByRole("heading", { level: 3, name: "Senior Product Designer, Payments" })).toBeVisible({ timeout: 60_000 });
  const [draft] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE origin = 'AGENT'`);
  await expect(drafts.getByRole("link", { name: "Review draft" })).toHaveAttribute("href", `/applications/${draft.id}`);
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`)).toHaveCount(0);
  await page.goto(`/applications/${draft.id}`);
  await expect(page.getByRole("link", { name: "From the job agent · waiting for review" })).toHaveAttribute("href", "/agent");

  // Approve it: a normal Draft application now, still unsent.
  await page.goto("/agent");
  await drafts.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Added to Applications as a draft. Nothing has been sent.")).toBeVisible();
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`).first()).toBeVisible();
  expect(await sql(`SELECT status, "awaitingReview" FROM "Application" WHERE id = $1`, [draft.id])).toEqual([{ status: "DRAFT", awaitingReview: false }]);

  // Dismiss the other one.
  await page.goto("/agent");
  await card(page, "Product Designer, Logistics").getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Dismissed. It won't come back.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Product Designer, Logistics" })).toHaveCount(0);

  // A later run brings none of them back…
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await sql(`UPDATE "Setting" SET value = $1 WHERE key = 'agentRuns'`, [JSON.stringify([{ at: twoHoursAgo, manual: true, message: null }])]);
  await page.reload();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText("No new postings this time.").first()).toBeVisible({ timeout: 30_000 });
  await expect(scored.getByRole("heading", { level: 3 })).toHaveCount(0);

  // …and Run now waits an hour after it.
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByText(/^The agent ran less than an hour ago\. Try again in (\d+ minutes|1 hour)\.$/)).toBeVisible();
});
