import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { contrastRatio } from "../src/lib/themes";

import { drawnColor, fillPosting, openJumpTo, resetData, sql } from "./support";

// Accessibility (E11-3, PRD §11: WCAG 2.2 AA). axe finds no serious or
// critical violations on any main screen or in its open states, and focus
// goes somewhere sensible wherever the browser alone wouldn't manage.

async function expectAccessible(page: Page) {
  // Not halfway through a fade, such as today's note writing itself (#523): axe would read the colour mid-way. Endless ones, such as a spinner, don't count.
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running" || animation.effect?.getComputedTiming().endTime === Infinity));
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
  // One status from the sidebar (E27-4).
  "/applications?status=sent&view=list",
  "/applications?status=closed",
  "/new",
  "/profile",
  "/profile?section=skills",
  "/profile?section=experience",
  "/profile?section=projects",
  "/profile?section=education",
  "/profile?section=certifications",
  "/profile?section=publications",
  "/profile?section=references",
  "/profile?section=facts",
  "/profile/import",
  "/resume",
  "/jobs",
  "/jobs?show=new",
  "/jobs?show=saved",
  "/jobs?show=dismissed",
  "/startups",
  "/agent",
  "/inbox",
  "/usage",
  // The dashboard's calendar on another month.
  "/?date=2026-11-01",
  "/settings",
  "/settings?section=ai",
  "/settings?section=jobs",
  "/settings?section=scoring",
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
    for (const tab of ["Cover letter", "Email", /^Job posting/]) {
      await page.getByRole("tab", { name: tab }).click();
      await expectAccessible(page);
    }
    // Under 1500 px, Notes is in the ⋯ menu (E30-3).
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Notes" }).click();
    await expectAccessible(page);
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

test("axe: Jump to, open with results (E27-6)", async ({ page, context, baseURL }) => {
  for (const scheme of ["light", "dark"]) {
    await context.addCookies([{ name: "dossier_theme", value: scheme, url: baseURL! }]);
    await page.goto("/");
    await (await openJumpTo(page)).fill("led");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectAccessible(page);
  }
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
  for (const tab of ["Cover letter", "Email", /^Job posting/]) {
    await page.getByRole("tab", { name: tab }).click();
    await expectAccessible(page);
  }
  // Under 1500 px, Notes is in the ⋯ menu, and the Fit column opens from its rail (E30-3).
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Notes" }).click();
  await expectAccessible(page);
  await page.getByRole("tab", { name: "Resume" }).click();
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
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

test("axe: a resume's sections (#297, #298)", async ({ page }) => {
  await page.goto("/resume?panel=sections");
  await expect(page.getByRole("button", { name: "Remove Experience" })).toBeVisible();
  await expectAccessible(page);

  await page.goto("/profile?section=new");
  await expect(page.getByRole("textbox", { name: "Section name" })).toBeFocused();
  await expectAccessible(page);

  await page.goto(application);
  await page.getByRole("button", { name: /^Sections/ }).click();
  await expect(page.getByRole("button", { name: "Remove Experience" })).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");

  // A section's page under Profile.
  await page.goto("/profile?section=new");
  await page.getByRole("button", { name: "Interests" }).click();
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page).toHaveURL(/section=custom/);
  await page.getByRole("button", { name: "+ Add an item" }).click();
  await expectAccessible(page);
});

test("axe: Positions with a search's results, and filtered (E14, E22-5)", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("list", { name: "Postings" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expectAccessible(page);

  await page.goto("/jobs?show=saved&portal=JSEARCH&age=week&covers=half");
  await expect(page.getByRole("button", { name: /^Found by: / })).toBeVisible();
  await expectAccessible(page);
  // A filter chip's menu, open (#519).
  await page.getByRole("button", { name: /^Portal: / }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expectAccessible(page);
  await page.keyboard.press("Escape");
});

test("axe: the theme builder and the review step of a new application", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("button", { name: /Make your own theme/ }).click();
  await expectAccessible(page);

  await page.goto("/new?fresh=1");
  await fillPosting(page, "Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma");
  await page.getByRole("button", { name: "Read the posting" }).click();
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeVisible();
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
  await fillPosting(page, "Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma");
  await page.getByRole("button", { name: "Read the posting" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeFocused();
  await page.getByRole("link", { name: "New", exact: true }).focus();
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

test("contrast: a segmented control's selected option is marked at 3:1 in both schemes (WCAG 1.4.11)", async ({ page, context, baseURL }) => {
  for (const scheme of ["light", "dark"]) {
    await context.addCookies([{ name: "dossier_theme", value: scheme, url: baseURL! }]);
    await page.goto("/applications");
    const view = page.getByRole("radiogroup", { name: "View" });
    const selected = view.getByRole("radio", { checked: true });
    expect(await selected.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("1px");
    const border = await drawnColor(selected, "border-top-color");
    expect(contrastRatio(border, await drawnColor(view, "background-color"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(border, await drawnColor(selected, "background-color"))).toBeGreaterThanOrEqual(3);
  }
});
