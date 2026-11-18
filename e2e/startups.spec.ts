import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fakeStartupRequests, resetData, sql } from "./support";

// Startups (#222) against the fake Hacker News and startup sites
// (e2e/fake-jobs.mts), for the demo profile in Rotterdam: what a refresh
// keeps and leaves out, the addresses it reads (people's only when asked),
// robots.txt and "no unsolicited applications", the filters, Dismiss with
// Undo, and Remove for good, which a refresh doesn't undo.
test.beforeAll(resetData);

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
}

test("finds hiring startups with the addresses they publish, and leaves alone what it should", async ({ page }) => {
  await page.goto("/startups");
  await expect(page.getByRole("note")).toContainText("Press Refresh to look for startups.");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Found 5 new startups.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Sources" }).getByText(/^Refreshed .* · reads their sites politely, following robots\.txt$/)).toBeVisible();

  // The list and its preview (E32-4). Remote work only for the US doesn't suit someone in Rotterdam.
  const list = page.getByRole("list", { name: "Startups" });
  const cards = list.getByRole("listitem");
  const row = (company: string) => list.getByRole("button", { name: new RegExp(company) });
  const preview = page.getByRole("region").filter({ has: page.getByRole("region", { name: "Facts" }) }).first();
  const open = async (company: string) => {
    await row(company).click();
    await expect(preview).toContainText(company);
  };
  await expect(cards).toHaveCount(5);
  await expect(row("Westcoast")).toHaveCount(0);
  // Hiring now holds them all.
  await expect(page.getByRole("navigation", { name: "Where they stand" }).getByRole("link", { name: /^Hiring now/ })).toHaveAttribute("aria-current", "page");

  // Role addresses from the startup's own pages; a person's only when asked.
  await open("Canalworks");
  await expect(row("Canalworks")).toContainText("hires from Netherlands");
  await expect(preview).toContainText("Remote, open to Netherlands");
  const addresses = preview.getByRole("list", { name: "Addresses they publish" });
  await expect(addresses).toContainText("jobs@canalworks.example");
  await expect(addresses).toContainText("hello@canalworks.example");
  await expect(addresses).not.toContainText("lena@canalworks.example");

  // Score, as a position is scored (#524): the scoring model's reasons replace the keyword match's, and stay.
  await preview.getByRole("button", { name: "Score", exact: true }).click();
  await expect(preview.getByRole("button", { name: "Score again" })).toBeVisible({ timeout: 30_000 });
  await expect(preview.getByRole("region", { name: "Why it fits" })).toContainText("Your product design roles match");
  expect((await fakeStartupRequests()).map((request) => request.url)).not.toContain("https://canalworks.example/team");
  await preview.getByRole("button", { name: "Look for people's addresses" }).click();
  await expect(addresses).toContainText("lena@canalworks.example");
  await expect(preview).toContainText("People's own addresses are dropped after 14 days unless you write to this startup.");

  // A site that takes no unsolicited applications gets none from here.
  await open("Quietco");
  await expect(preview.getByRole("note")).toContainText("We do not accept unsolicited applications.");
  await expect(preview.getByRole("link", { name: /^Start application/ })).toHaveCount(0);

  // Tulipworks' robots.txt keeps Dossier out, and every request says what it is.
  const requests = await fakeStartupRequests();
  expect(requests.filter((request) => request.url.includes("tulipworks")).map((request) => request.url)).toEqual(["https://tulipworks.example/robots.txt"]);
  expect(requests.every((request) => /Dossier\/[\w.-]+; \+https:\/\/github\.com\/AienTech\/dossier\/blob\/main\/PRIVACY\.md#startups/.test(request.userAgent))).toBe(true);
  await open("Tulipworks");
  await expect(preview.getByRole("list", { name: "Addresses they publish" })).toHaveCount(0);

  await expectAccessible(page);

  // Filters: remote work open to the Netherlands, then Rotterdam itself; each chip opens a menu (#519).
  const where = async (choice: string) => {
    await page.getByRole("button", { name: /^Where: / }).click();
    await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
  };
  await where("remote, open to Netherlands");
  await expect(cards).toHaveCount(2);
  await where("Rotterdam");
  await expect(cards).toHaveCount(1);
  await expect(row("Harbourlight")).toBeVisible();
  await where("anywhere");
  await expect(cards).toHaveCount(5);

  // Dismiss, and Undo.
  await open("Faraway");
  await preview.getByRole("button", { name: "Dismiss" }).click();
  await expect(row("Faraway")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row("Faraway")).toBeVisible();

  // Start application: New application starts from what's known, without any
  // address, and the email goes to the address the startup publishes.
  await open("Canalworks");
  await preview.getByRole("link", { name: /^Start application/ }).click();
  await expect(page).toHaveURL(/\/new$/);
  const posting = page.getByLabel("Job posting");
  await expect(posting).toHaveValue(/Canalworks \(YC W25\) Is Hiring a Product Designer/);
  await expect(posting).not.toHaveValue(/@/);
  await page.getByRole("button", { name: "Read the posting" }).click();
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByRole("button", { name: "Write the email" }).click();
  await expect(page.getByRole("article", { name: "Email" }).getByRole("group", { name: "Recipient" })).toContainText("jobs@canalworks.example");
  // It's under Applied for now (PL1), with its application.
  await page.goto("/startups?view=applied");
  await expect(cards).toHaveCount(1);
  await open("Canalworks");
  await expect(preview.getByRole("link", { name: "Open the application" })).toBeVisible();

  // Removed for good: only hashes stay, and a refresh doesn't bring it back.
  await page.goto("/startups");
  await open("Harbourlight");
  await preview.getByRole("button", { name: "Remove for good" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove for good" }).click();
  await expect(row("Harbourlight")).toHaveCount(0);
  expect(await sql(`SELECT count(*)::int AS n FROM "StartupBlock"`)).toEqual([{ n: 3 }]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("No new startups this time.")).toBeVisible({ timeout: 30_000 });
  await expect(row("Harbourlight")).toHaveCount(0);
  await expect(cards).toHaveCount(4);
});
