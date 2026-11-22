import { expect, test } from "@playwright/test";

import { openJumpTo, resetData, sql } from "./support";

// The sidebar and Jump to (E27): statuses under Applications, each profile by
// name, ⌘K from anywhere, and the application screen's own rail.
test.beforeAll(resetData);

test("the sidebar's statuses open the list of that status, with their counts (E27-4)", async ({ page }) => {
  const [{ sent }] = await sql<{ sent: number }>(`SELECT count(*)::int AS sent FROM "Application" WHERE status = 'SENT' AND "archivedAt" IS NULL AND "awaitingReview" = false`);
  await page.goto("/");
  const statuses = page.getByRole("list", { name: "Applications by status" });
  const link = statuses.getByRole("link", { name: /^Sent/ });
  await expect(link).toContainText(String(sent));
  await link.click();
  // A status opens as a list (LB1).
  await expect(page).toHaveURL(/\/applications\?status=sent$/);
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(sent + 1);
});

test("each profile is listed by name, with its Profile and Base resume (E27-5)", async ({ page }) => {
  await page.goto("/");
  const profiles = page.getByRole("list", { name: "Your profiles" });
  await expect(profiles.getByRole("link").first()).toBeVisible();
  await profiles.getByRole("link", { name: "Base resume" }).click();
  await expect(page).toHaveURL(/\/resume\?profile=/);
  await expect(profiles.getByRole("link", { name: "Base resume" })).toHaveAttribute("aria-current", "page");
});

test("Jump to finds an application and opens it, from the keyboard (E27-6)", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.goto("/settings?section=about");
  const input = await openJumpTo(page);
  await expect(input).toBeFocused();
  await input.fill("ledgerly");
  await expect(page.getByRole("group", { name: "Applications", exact: true }).getByRole("option").first()).toContainText("Ledgerly");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/applications/${ledgerly.id}$`));
});

test("an application's screen starts with the sidebar collapsed, and keeps its own choice (E27-8)", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.goto(`/applications/${ledgerly.id}`);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(sidebar).not.toHaveAttribute("data-collapsed");

  // The other pages kept theirs.
  await page.goto("/applications");
  await expect(sidebar).not.toHaveAttribute("data-collapsed");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.goto(`/applications/${ledgerly.id}`);
  await expect(sidebar).not.toHaveAttribute("data-collapsed");
});

test("Jump to opens what's typed even when Enter comes before the results (E27-6)", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.goto("/usage");
  await (await openJumpTo(page)).fill("ledgerly");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/applications/${ledgerly.id}$`));
});
