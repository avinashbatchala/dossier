import { expect, test } from "@playwright/test";

import { fakeJobSearches, resetData, sql } from "./support";

// The job agent end to end (E16, E22-8): turned on in Settings, run now
// against the fake JSearch and the fake AI, what it found in Positions, a
// draft prepared there and approved on the Agent screen, a posting
// dismissed, and a second run that brings none of them back.
test.beforeAll(resetData);
// Off again, so its timer leaves the other specs alone.
test.afterAll(async () => {
  await sql(`DELETE FROM "Setting" WHERE key LIKE 'agent%'`);
  await sql(`DELETE FROM "AgentCandidate"`);
  await sql(`DELETE FROM "AgentSearch"`);
});

test("finds, scores, drafts and dismisses, and never brings a posting back", async ({ page }) => {
  await page.goto("/settings?section=agent");
  await page.getByRole("button", { name: "Add search" }).click();
  await page.getByLabel("Search name").fill("Design roles");
  await page.getByLabel("What").fill("Product designer");
  await page.getByLabel("Country").selectOption("nl");
  await page.getByRole("button", { name: "Save search" }).click();
  await expect(page.getByRole("switch", { name: "Design roles" })).toBeVisible();
  await page.getByRole("switch", { name: "Run the job agent" }).click();
  await expect(page.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("All changes saved")).toBeVisible();

  // Run now: one search, three postings scored, two in the queue.
  const searches = await fakeJobSearches();
  await page.getByRole("link", { name: "Agent", exact: true }).click();
  await expect(page).toHaveURL("/agent");
  await page.getByRole("button", { name: "Run all now" }).click();
  await expect(page.getByText("2 new postings are waiting for a look.").first()).toBeVisible({ timeout: 30_000 });
  expect(await fakeJobSearches()).toBe(searches + 1);
  // Its best finds, and what it skipped with why (E32-5).
  const tabs = page.getByRole("navigation", { name: "What it found" });
  await expect(tabs.getByRole("link", { name: /^Best finds/ })).toHaveText("Best finds 2");
  await tabs.getByRole("link", { name: /^Skipped/ }).click();
  await expect(page.getByRole("list", { name: "Skipped" }).getByRole("button", { name: /^UX Designer/ })).toContainText("Lists no requirements to check");
  // What it found is in Positions too, best fit first, the one under the cut-off too (E22-8).
  await page.goto("/jobs?found=agent");
  const list = page.getByRole("list", { name: "Postings" });
  const posting = (title: string) => list.getByRole("button", { name: new RegExp(`^${title}`) });
  await expect(list.locator("button[data-posting]")).toHaveCount(3);
  await expect(list.locator("button[data-posting]").first()).toContainText("Senior Product Designer, Payments");
  await expect(posting("Senior Product Designer, Payments")).toContainText("Found by the agent · Design roles");
  await expect(posting("Senior Product Designer, Payments").getByRole("img", { name: /^\d+ of \d+ requirements covered$/ })).toBeVisible();
  await expect(list.locator("button[data-posting]").last()).toContainText("UX Designer");

  // Prepare a draft there: it waits for review on the Agent screen, out of Applications.
  await page.getByRole("button", { name: "Prepare draft" }).click();
  await expect(page.getByText("The draft is ready for your review on the Agent screen.")).toBeVisible({ timeout: 60_000 });
  await page.goto("/agent");
  const drafts = page.getByRole("list", { name: "Drafts to review" });
  await expect(drafts.getByRole("button", { name: /^Senior Product Designer, Payments/ })).toContainText("resume and letter ready");
  const [draft] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE origin = 'AGENT'`);
  await expect(page.getByRole("link", { name: "Review draft" })).toHaveAttribute("href", `/applications/${draft.id}`);
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`)).toHaveCount(0);
  await page.goto(`/applications/${draft.id}`);
  await expect(page.getByRole("link", { name: "From the job agent · waiting for review" })).toHaveAttribute("href", "/agent");

  // Approve it: a normal Draft application now, still unsent.
  await page.goto("/agent");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Added to Applications as a draft. Nothing has been sent.")).toBeVisible();
  await page.goto("/applications?view=table");
  await expect(page.locator(`a[href="/applications/${draft.id}"]`).first()).toBeVisible();
  expect(await sql(`SELECT status, "awaitingReview" FROM "Application" WHERE id = $1`, [draft.id])).toEqual([{ status: "DRAFT", awaitingReview: false }]);

  // Dismiss the other one, in Positions.
  await page.goto("/jobs?found=agent");
  await posting("Product Designer, Logistics").click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Dismissed. It won't come back, from any search.")).toBeVisible();
  await expect(posting("Product Designer, Logistics")).toHaveCount(0);
  await page.goto("/agent");

  // A later run brings none of them back…
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  await sql(`UPDATE "Setting" SET value = $1 WHERE key = 'agentRuns'`, [JSON.stringify([{ at: twoHoursAgo, manual: true, message: null }])]);
  await page.reload();
  await page.getByRole("button", { name: "Run all now" }).click();
  await expect(page.getByText("No new postings this time.").first()).toBeVisible({ timeout: 30_000 });

  // …and Run now waits an hour after it.
  await page.getByRole("button", { name: "Run all now" }).click();
  await expect(page.getByText(/^The agent ran less than an hour ago\. Try again in (\d+ minutes|1 hour)\.$/)).toBeVisible();
});
