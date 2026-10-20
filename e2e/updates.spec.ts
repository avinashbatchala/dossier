import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// The update notice (E10-9): while a check has found a newer release than
// this one, the sidebar says so on every page until "Not now", which holds
// until a newer release still. Settings → About says so too.

const release = (version: string) => ({ version, url: `https://github.com/AienTech/dossier/releases/tag/v${version}` });

/** Stores a release as the one the update check found last. */
async function found({ version, url }: { version: string; url: string }) {
  for (const [key, value] of [
    ["latestVersion", version],
    ["latestVersionUrl", url],
  ]) {
    await sql(
      `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $2, "updatedAt" = now()`,
      [key, value],
    );
  }
}

const expectAccessibleSidebar = async (page: Page) => {
  const { violations } = await new AxeBuilder({ page }).include("aside").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
};

test.beforeAll(resetData);
// Other specs see no notice.
test.afterAll(() => sql(`DELETE FROM "Setting" WHERE key IN ('latestVersion', 'latestVersionUrl', 'updateDismissed')`));

test("says a newer release is out until Not now, and again for the next one", async ({ page, context, baseURL }) => {
  await found(release("99.0.0"));
  await page.goto("/");
  const notice = page.getByRole("region", { name: "Dossier 99.0.0 is out" });
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: /What's new/ })).toHaveAttribute("href", release("99.0.0").url);
  await expect(notice.getByRole("link", { name: /How to update/ })).toHaveAttribute("href", "https://github.com/AienTech/dossier/wiki/Upgrading");
  await expectAccessibleSidebar(page);

  await page.goto("/settings?section=about");
  await expect(page.getByText("Version 99.0.0 is available.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Check for updates daily" })).toHaveAttribute("aria-checked", "true");

  await notice.getByRole("button", { name: "Not now" }).click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("button", { name: /^(Dark|Light) mode$/ })).toBeFocused();
  await page.goto("/applications");
  await expect(page.getByRole("region", { name: /is out$/ })).toBeHidden();

  await found(release("99.1.0"));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Dossier 99.1.0 is out" })).toBeVisible();

  // With the sidebar collapsed, it's an icon that opens the sidebar on the notice.
  await context.addCookies([{ name: "dossier_sidebar", value: "collapsed", url: baseURL! }]);
  await page.goto("/");
  await expect(page.getByRole("region", { name: /is out$/ })).toBeHidden();
  await expectAccessibleSidebar(page);
  await page.getByRole("button", { name: "Dossier 99.1.0 is out" }).click();
  await expect(page.getByRole("region", { name: "Dossier 99.1.0 is out" })).toBeVisible();
  await expect(page.getByRole("link", { name: /What's new/ })).toBeFocused();
});
