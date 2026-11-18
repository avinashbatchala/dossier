import { expect, test } from "@playwright/test";

import { fakeJobSearches, resetData, sql } from "./support";

// Find jobs (E14) against the fake job sources: search from the profile's
// role and city, come back to the kept search without asking again, save,
// dismiss and undo, then start an application from a posting and see it
// marked as applied for.
test.beforeAll(resetData);

test("searches, keeps postings, and starts an application from one", async ({ page }) => {
  await page.goto("/jobs");
  const form = page.getByRole("search", { name: "Search postings" });
  // The first search starts from the current role and the profile's city and country.
  await expect(form.getByLabel("What")).toHaveValue("Senior Product Designer");
  await expect(form.getByLabel("Where")).toHaveValue("Rotterdam");
  await expect(form.getByLabel("Country")).toHaveValue("nl");
  await form.getByRole("button", { name: "Search" }).click();

  // A search lands on Positions, filtered to what it found (E22-5).
  await expect(page).toHaveURL(/\/jobs\?found=c/);
  const list = page.getByRole("list", { name: "Postings" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await expect(page.getByText("Ledgerly · Rotterdam · EUR 75,000–90,000 a year")).toBeVisible();
  await expect(page.getByRole("region", { name: "Posting text" })).toContainText("Strong prototyping skills in Figma");

  // The next page, through the cursor, into the library.
  await page.getByRole("button", { name: "More from JSearch" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("button", { name: "More from JSearch" })).toHaveCount(0);

  // Every posting is kept, once (E22-5): coming back to them, or to the search, asks the portal nothing.
  const asked = await fakeJobSearches();
  await page.goto("/jobs");
  await expect(list.getByRole("listitem")).toHaveCount(4);
  // After Any search and The job agent (E22-8).
  await page.getByRole("button", { name: /^Found by: / }).click();
  await page.getByRole("menuitemradio").nth(2).click();
  await expect(page).toHaveURL(/found=c/);
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Search" }).getByText(/^Searched today at \d\d:\d\d · 4 found$/)).toBeVisible();
  expect(await fakeJobSearches()).toBe(asked);

  // Save the first; dismiss the second, then undo it.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(list.getByRole("button", { name: /^Senior Product Designer, Payments/ })).toContainText("Saved");
  await list.getByRole("button", { name: /^Product Designer, Logistics/ }).click();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(list.getByRole("button", { name: /^Product Designer, Logistics/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(list.getByRole("button", { name: /^Product Designer, Logistics/ })).toBeVisible();

  // The saved posting is in Saved.
  await page.getByRole("link", { name: /^Saved/ }).click();
  await expect(page).toHaveURL(/\/jobs\?(.*&)?show=saved/);
  await expect(page.getByText("1 saved posting")).toBeVisible();

  // Start an application from it: the posting is filled in, to check first.
  await page.getByRole("button", { name: "Start application →" }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByLabel("Job posting")).toHaveValue(/^Ledgerly: Senior Product Designer, Payments\n\nRotterdam · EUR 75,000–90,000 a year\n\nLedgerly is hiring/);
  await expect(page.getByLabel(/^Link to the posting/)).toHaveValue("https://jobs.example/e2e-ledgerly");
  await page.getByRole("button", { name: "Read the posting" }).click();
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeVisible();
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  const applicationId = new URL(page.url()).pathname.split("/").pop()!;

  // The posting now knows its application, and says so.
  const [posting] = await sql<{ applicationId: string | null }>(`SELECT "applicationId" FROM "Posting" WHERE "externalId" = 'e2e-ledgerly'`);
  expect(posting.applicationId).toBe(applicationId);
  await page.goto("/jobs?view=saved");
  await expect(page.getByRole("list", { name: "Postings" }).getByRole("button", { name: /^Senior Product Designer, Payments/ })).toContainText("Applied");
  await expect(page.getByRole("link", { name: "Open the application" })).toHaveAttribute("href", `/applications/${applicationId}`);
});

test("says when nothing was found", async ({ page }) => {
  // A search written in the URL only fills in the form.
  await page.goto("/jobs?q=nothing&where=Rotterdam&country=nl");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No postings for “nothing” within 25 km of Rotterdam. Try a bigger radius or fewer words.")).toBeVisible();
});

test("tests the connection in Settings → Job search", async ({ page }) => {
  await page.goto("/settings?section=jobs");
  await expect(page.getByRole("switch", { name: /^JSearch/ })).toBeChecked();
  await expect(page.getByLabel("API key")).toHaveAttribute("placeholder", "Using DOSSIER_JSEARCH_KEY · type one to save it here");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Connected · JSearch answered in/)).toBeVisible();
});

test("scores a posting against the profile, and keeps the score (#208)", async ({ page }) => {
  // Before the test above, nothing was saved, dismissed or applied for.
  await resetData();
  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  // Coverage, never a number out of 100 (E32-2), then each part of the fit as a reason (E25-6).
  const detail = page.getByRole("region", { name: "Senior Product Designer, Payments" });
  await expect(detail.getByRole("img", { name: /^\d+ of \d+ requirements covered$/ })).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByRole("listitem").first()).toHaveText(/^✓In favour: Requirements: You show 2 of 2 must-haves\.$/);
  await expect(detail.getByText(/Your product design roles match/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("of 100");
  await expect(page.getByRole("list", { name: "Postings" }).getByRole("img", { name: /^\d+ of \d+ requirements covered$/ })).toBeVisible();

  // Another scores from its preview, and its ring shows in the list too (E32-3).
  await page.getByRole("list", { name: "Postings" }).getByRole("button", { name: /^Product Designer, Logistics/ }).click();
  await page.getByRole("region", { name: "How it fits" }).getByRole("button", { name: "Score" }).click();
  await expect(page.getByRole("list", { name: "Postings" }).getByRole("img", { name: /requirements covered$/ })).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole("list", { name: "Postings" }).getByRole("button", { name: /^Senior Product Designer, Payments/ }).click();

  // Kept with the posting, so it's there after a reload.
  await page.reload();
  await expect(detail.getByRole("img", { name: /^\d+ of \d+ requirements covered$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Score again" })).toBeVisible();
  await sql(`DELETE FROM "PostingScore"`);
});

test("scores with Jev once it's chosen in Settings → Scoring (#274)", async ({ page }) => {
  await resetData();
  await page.goto("/settings?section=scoring");
  await page.getByRole("radio", { name: "Jev by TypeSafe" }).click();
  await expect(page.getByRole("note")).toContainText("Each posting you score goes to TypeSafe");
  const key = page.getByLabel("TypeSafe key");
  await key.fill("e2e-typesafe-key");
  await key.press("Enter");
  await expect(key).toHaveAttribute("placeholder", "Saved · type a new key to replace it");
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/^Connected · jev-1\.14\.0 answered in/)).toBeVisible();

  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await page.getByRole("button", { name: "Score", exact: true }).click();
  // Jev answers the same questions (E25): every factor at the top but the past work, a level below.
  const scored = page.getByRole("region", { name: "Senior Product Designer, Payments" });
  await expect(scored.getByRole("img", { name: /^\d+ of \d+ requirements covered$/ })).toBeVisible({ timeout: 30_000 });
  await expect(scored.getByRole("listitem").first()).toHaveText(/^✓In favour: Requirements: You show 2 of 2 must-haves\.$/);
  await expect(scored.getByRole("listitem").nth(1)).toHaveText(/^✓In favour: Work experience: You've done similar work, in another setting or with other tools\.$/);
  expect((await sql<{ scoredWith: string }>(`SELECT "scoredWith" FROM "PostingScore"`))[0]?.scoredWith).toBe("score-posting-jev@2 (jev-1.14.0)");

  await sql(`DELETE FROM "PostingScore"`);
  await sql(`DELETE FROM "Setting" WHERE key IN ('scorer', 'typesafeKeyEnc')`);
});

test("searches FreeHire, which needs no key and has no radius", async ({ page }) => {
  const on = async (source: string, state: boolean) =>
    expect.poll(async () => (JSON.parse((await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'portals'`))[0]?.value ?? "{}") as Record<string, { on: boolean }>)[source]?.on).toBe(state);
  await page.goto("/settings?section=jobs");
  // Any number of portals can be on (E22-3); this one searches FreeHire alone.
  await page.getByRole("switch", { name: /^FreeHire/ }).click();
  await expect(page.getByText("No key needed. Dossier searches FreeHire's public catalogue at freehire.me.")).toBeVisible();
  await on("FREEHIRE", true);
  await page.getByRole("switch", { name: /^JSearch/ }).click();
  await on("JSEARCH", false);

  await page.goto("/jobs?q=product+designer&where=Rotterdam&country=nl");
  const form = page.getByRole("search", { name: "Search postings" });
  await expect(form.getByLabel("Within")).toBeDisabled();
  await expect(form.getByText("FreeHire has no distance filter")).toBeVisible();
  await form.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Senior Product Designer, Payments" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Search" }).getByText(/^Searched today at \d\d:\d\d · 1 found$/)).toBeVisible();
  // The same job JSearch found before: one posting, found on both, with each one's credit (E22-6).
  // Each portal's name links to its page, so the line is in pieces.
  await expect(page.getByText(/^Found on/)).toHaveText(/^Found on JSearch.*and FreeHire.*, as the same job\./);
  await expect(page.getByRole("list", { name: "Postings" }).getByRole("button", { name: /^Senior Product Designer, Payments/ })).toContainText("JSearch and FreeHire");
  await expect(page.getByRole("region", { name: "Posting text" })).toContainText("Strong prototyping skills in Figma");
  await expect(page.getByText("Jobs by FreeHire").last()).toBeVisible();

  // Back to JSearch alone, as the environment sets it, for the tests after.
  await page.goto("/settings?section=jobs");
  await page.getByRole("switch", { name: /^JSearch/ }).click();
  await on("JSEARCH", true);
  await page.getByRole("switch", { name: /^FreeHire/ }).click();
  await on("FREEHIRE", false);
});
