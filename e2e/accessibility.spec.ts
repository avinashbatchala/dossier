import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// Accessibility (E11-3, PRD §11: WCAG 2.2 AA). axe finds no serious or
// critical violations on any main screen or in its open states, and focus
// goes somewhere sensible wherever the browser alone wouldn't manage.

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`);
  expect(serious).toEqual([]);
}

let application = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  application = `/applications/${ledgerly.id}`;
});

const SCREENS = [
  "/",
  "/applications",
  "/applications?view=table",
  "/new",
  "/profile",
  "/profile?section=skills",
  "/profile?section=experience",
  "/profile?section=education",
  "/profile?section=references",
  "/profile/import",
  "/resume",
  "/jobs",
  "/jobs?view=history",
  "/jobs?view=saved",
  "/jobs?view=dismissed",
  "/agent",
  "/inbox",
  "/calendar",
  "/calendar?view=month",
  "/settings?section=ai",
  "/settings?section=jobs",
  "/settings?section=agent",
  "/settings?section=documents",
  "/settings?section=google",
  "/settings?section=data",
  "/settings?section=about",
  "/applications/nope",
  "/nowhere",
];

for (const path of SCREENS) {
  test(`axe: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectAccessible(page);
  });
}

// The dark scheme and the collapsed sidebar (chosen in the sidebar, kept in
// cookies) on every main screen too.
test.describe("dark, with the sidebar collapsed", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: "dossier_theme", value: "dark", url: baseURL! },
      { name: "dossier_sidebar", value: "collapsed", url: baseURL! },
    ]);
  });

  for (const path of SCREENS) {
    test(`axe: ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await expectAccessible(page);
    });
  }

  test("axe: an application, on every tab", async ({ page }) => {
    await page.goto(application);
    await expectAccessible(page);
    for (const tab of ["Cover letter", "Email", /^Job posting/, /^Notes/]) {
      await page.getByRole("tab", { name: tab }).click();
      await expectAccessible(page);
    }
  });

  test("axe: open menus and the sign-in page", async ({ page, context, baseURL }) => {
    await page.goto(application);
    await page.getByRole("button", { name: "More actions" }).click();
    await expectAccessible(page);
    await context.clearCookies({ name: "dossier_session" });
    await context.addCookies([{ name: "dossier_theme", value: "dark", url: baseURL! }]);
    await page.goto("/login");
    await expectAccessible(page);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("axe: the sign-in page", async ({ page }) => {
    await page.goto("/login");
    await expectAccessible(page);
  });
});

test("axe: an application, on every tab and with a part being edited", async ({ page }) => {
  await page.goto(application);
  await expectAccessible(page);
  for (const tab of ["Cover letter", "Email", /^Job posting/, /^Notes/]) {
    await page.getByRole("tab", { name: tab }).click();
    await expectAccessible(page);
  }
  await page.getByRole("tab", { name: "Resume" }).click();
  const summary = page.locator('[data-unit="summary"]');
  await summary.hover();
  await summary.getByRole("button", { name: "Edit" }).click();
  await expectAccessible(page);
});

test("axe: an application's email, once it's written", async ({ page }) => {
  const units = [
    { id: "to", label: "Recipient", text: "" },
    { id: "subject", label: "Subject", text: "Application: Senior Product Designer, Payments" },
    { id: "body", label: "Message", text: "Dear Ledgerly team,\n\nI'm applying for the role.\n\nWarm regards,\nJane Doe" },
  ];
  await sql(
    `INSERT INTO "Document" (id, "applicationId", kind, units, "updatedAt") VALUES ('a11y-email', $1, 'EMAIL', $2, now())
     ON CONFLICT ("applicationId", kind) DO UPDATE SET units = EXCLUDED.units`,
    [application.split("/").at(-1), JSON.stringify(units)],
  );
  await page.goto(`${application}?tab=email`);
  await expect(page.getByRole("article", { name: "Email" })).toBeVisible();
  await expectAccessible(page);
});

test("axe: the dashboard for the last 30 days, with the charts' numbers showing", async ({ page }) => {
  await page.goto("/?period=30d");
  for (const chart of ["Your funnel", "Week by week"]) await page.getByRole("region", { name: chart }).getByText("Show the numbers").click();
  await expect(page.getByRole("table", { name: /^How far your sent applications got/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "Applications started and sent per week" })).toBeVisible();
  await expectAccessible(page);
});

test("axe: an interview's date, being set", async ({ page }) => {
  const [northstar] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Northstar Health'`);
  await page.goto(`/applications/${northstar.id}`);
  await page.getByRole("button", { name: /^Next interview:/ }).click();
  await expect(page.getByRole("dialog", { name: "Next interview" })).toBeVisible();
  await expectAccessible(page);
});

test("axe: open menus and dialogs", async ({ page }) => {
  await page.goto("/applications");
  await page.getByRole("button", { name: /^Actions for Product Designer, Mobile, Kestrel Maps/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectAccessible(page);

  await page.goto(application);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expectAccessible(page);

  await page.goto("/settings?section=data");
  await page.getByRole("button", { name: "Delete everything…" }).click();
  await expectAccessible(page);
});

test("axe: Find jobs with results, and its past searches (E14)", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("list", { name: "Postings" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectAccessible(page);

  await page.goto("/jobs?view=history");
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await expectAccessible(page);
});

test("axe: the theme builder and the review step of a new application", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("button", { name: /Make your own theme/ }).click();
  await expectAccessible(page);

  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill("Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma");
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await expectAccessible(page);
});

test("keyboard: a part's toolbar opens from the keyboard, and Escape comes back", async ({ page }) => {
  await page.goto(application);
  const summary = page.locator('[data-unit="summary"]');
  // Tab from the tabs to the first part, as a keyboard user would.
  await page.getByRole("tab", { name: "Resume" }).focus();
  for (let step = 0; step < 20 && !(await summary.evaluate((element) => element === document.activeElement)); step++) {
    await page.keyboard.press("Tab");
  }
  await expect(summary).toBeFocused();
  await page.keyboard.press("Tab");
  const edit = summary.getByRole("button", { name: "Edit" });
  await expect(edit).toBeFocused();
  await expect(edit).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Edit Summary" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(summary).toBeFocused();
});

test("keyboard: each step of a new application takes focus", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill("Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma");
  await page.getByRole("button", { name: "Read the posting →" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "The application" })).toBeFocused();
  await page.getByRole("button", { name: "← Back to the posting" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Job posting")).toBeFocused();
});

test("keyboard: the theme builder hands focus on", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("button", { name: /Make your own theme/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Theme name")).toBeFocused();
  await page.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /theme, in use$/ })).toBeFocused();
});

test("keyboard: a dialog starts on Cancel and gives focus back", async ({ page }) => {
  await page.goto(application);
  await page.getByRole("button", { name: "More actions" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Delete…" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alertdialog").getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "More actions" })).toBeFocused();
});
