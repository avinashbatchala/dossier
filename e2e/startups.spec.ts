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
  await expect(page.getByText(/Last refreshed .*: Y Combinator 2 · Hacker News 3\./)).toBeVisible();

  // The whole country by default: on-site work in Austin, Texas isn't a maybe
  // for someone in Rotterdam, and neither is remote work only for the US.
  const cards = page.getByRole("article");
  await expect(cards).toHaveCount(4);
  await expect(page.getByRole("article", { name: "Westcoast" })).toHaveCount(0);
  await expect(page.getByRole("article", { name: "Faraway" })).toHaveCount(0);

  // Role addresses from the startup's own pages; a person's only when asked.
  const canal = page.getByRole("article", { name: "Canalworks" });
  await expect(canal).toContainText("Remote, open to Netherlands");
  const addresses = canal.getByRole("list", { name: "Addresses they publish" });
  await expect(addresses).toContainText("jobs@canalworks.example");
  await expect(addresses).toContainText("hello@canalworks.example");
  await expect(addresses).not.toContainText("lena@canalworks.example");
  expect((await fakeStartupRequests()).map((request) => request.url)).not.toContain("https://canalworks.example/team");
  await canal.getByRole("button", { name: "Look for people's addresses" }).click();
  await expect(addresses).toContainText("lena@canalworks.example");
  await expect(canal).toContainText("People's own addresses are dropped after 14 days unless you write to this startup.");

  // A site that takes no unsolicited applications gets none from here.
  const quiet = page.getByRole("article", { name: "Quietco" });
  await expect(quiet.getByRole("note")).toContainText("We do not accept unsolicited applications.");
  await expect(quiet.getByRole("link", { name: "Write to them" })).toHaveCount(0);

  // Tulipworks' robots.txt keeps Dossier out, and every request says what it is.
  const requests = await fakeStartupRequests();
  expect(requests.filter((request) => request.url.includes("tulipworks")).map((request) => request.url)).toEqual(["https://tulipworks.example/robots.txt"]);
  expect(requests.every((request) => /Dossier\/[\w.-]+; \+https:\/\/github\.com\/AienTech\/dossier\/blob\/main\/PRIVACY\.md#startups/.test(request.userAgent))).toBe(true);
  await expect(page.getByRole("article", { name: "Tulipworks" }).getByRole("list", { name: "Addresses they publish" })).toHaveCount(0);

  await expectAccessible(page);

  // Filters: remote work open to the Netherlands, then Rotterdam itself, then
  // the whole country, and finally anywhere in the world.
  await page.getByLabel("Where").selectOption("remote");
  await expect(cards).toHaveCount(2);
  await page.getByLabel("Where").selectOption("city");
  await expect(cards).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Harbourlight" })).toBeVisible();
  await page.getByLabel("Where").selectOption("country");
  await expect(cards).toHaveCount(4);
  await page.getByLabel("Where").selectOption("any");
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole("article", { name: "Faraway" })).toBeVisible();

  // Dismiss, and Undo.
  const faraway = page.getByRole("article", { name: "Faraway" });
  await faraway.getByRole("button", { name: "Dismiss" }).click();
  await expect(faraway).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(faraway).toBeVisible();

  // Write to them: New application starts from what's known, without any
  // address, and the email goes to the address the startup publishes.
  await canal.getByRole("link", { name: "Write to them" }).click();
  await expect(page).toHaveURL(/\/new$/);
  const posting = page.getByLabel("Job posting");
  await expect(posting).toHaveValue(/Canalworks \(YC W25\) Is Hiring a Product Designer/);
  await expect(posting).not.toHaveValue(/@/);
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  await page.getByRole("tab", { name: "Email" }).click();
  await page.getByRole("button", { name: "Write the email" }).click();
  await expect(page.getByRole("article", { name: "Email" }).getByRole("group", { name: "Recipient" })).toContainText("jobs@canalworks.example");
  await page.goto("/startups");
  await expect(canal.getByRole("link", { name: "Open the application" })).toBeVisible();

  // Removed for good: only hashes stay, and a refresh doesn't bring it back.
  const harbour = page.getByRole("article", { name: "Harbourlight" });
  await harbour.getByRole("button", { name: "Remove for good" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove for good" }).click();
  await expect(harbour).toHaveCount(0);
  expect(await sql(`SELECT count(*)::int AS n FROM "StartupBlock"`)).toEqual([{ n: 3 }]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("No new startups this time.")).toBeVisible({ timeout: 30_000 });
  await expect(harbour).toHaveCount(0);
  await expect(cards).toHaveCount(3);
});
