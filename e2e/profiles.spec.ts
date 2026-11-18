import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { fillPosting, resetData, sql } from "./support";

// Several profiles (E24-2): making one as a copy, switching, each with its
// own sections and Base resume, renaming and deleting.

test.beforeAll(resetData);
test.afterAll(async () => {
  await resetData();
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
}

const switcher = (page: Page, name: string) => page.getByRole("button", { name: `Profile: ${name}` });

test("makes a profile as a copy, keeps each profile's own sections and Base resume, renames and deletes it", async ({ page }) => {
  await page.goto("/profile?section=basics");
  await switcher(page, "Senior Product Designer").click();
  await expect(page.getByRole("menuitem", { name: "Delete “Senior Product Designer”…" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("menuitem", { name: "New profile…" }).click();
  await page.getByRole("dialog", { name: "New profile" }).getByLabel("Name").fill("Design systems");
  await page.getByRole("radio", { name: "A copy" }).click();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Make profile" }).click();

  // The copy opens, with everything the first one has.
  await expect(switcher(page, "Design systems")).toBeVisible();
  await expect(page).toHaveURL(/profile=/);
  // The headline sits with the summary (E33-1).
  await page.getByRole("link", { name: /^Headline and summary/ }).click();
  const headline = page.getByLabel("Headline", { exact: true });
  await expect(headline).toHaveValue("Senior Product Designer");
  await headline.fill("Design Systems Lead");
  await headline.blur();
  await expect.poll(async () => (await sql<{ headline: string }>(`SELECT headline FROM "Profile" WHERE name = 'Design systems'`))[0]?.headline).toBe("Design Systems Lead");

  // Its Base resume is its own: a language here leaves the other's alone.
  await page.getByRole("link", { name: "See base resume →" }).click();
  await expect(switcher(page, "Design systems")).toBeVisible();
  await page.getByLabel("Language", { exact: true }).selectOption("German");
  await expect.poll(async () => (await sql<{ language: string }>(`SELECT settings->>'resumeLanguage' AS language FROM "Profile" WHERE name = 'Design systems'`))[0]?.language).toBe("German");
  await expect(page.getByRole("article", { name: "Resume" }).getByText("Design Systems Lead")).toBeVisible();

  // Switching opens the other, on this page and on Profile from then on.
  await switcher(page, "Design systems").click();
  await page.getByRole("menuitemradio", { name: "Senior Product Designer" }).click();
  await expect(switcher(page, "Senior Product Designer")).toBeVisible();
  await expect(page.getByLabel("Language", { exact: true })).toHaveValue("English");
  await page.goto("/profile?section=summary");
  await expect(page.getByLabel("Headline", { exact: true })).toHaveValue("Senior Product Designer");

  // Renamed, then deleted once confirmed; the first one opens again.
  await page.goto("/profile?section=basics");
  await switcher(page, "Senior Product Designer").click();
  await page.getByRole("menuitemradio", { name: "Design systems" }).click();
  await switcher(page, "Design systems").click();
  await page.getByRole("menuitem", { name: "Rename “Design systems”…" }).click();
  await page.getByRole("dialog", { name: "Rename profile" }).getByLabel("Name").fill("Systems");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(switcher(page, "Systems")).toBeVisible();
  await switcher(page, "Systems").click();
  await page.getByRole("menuitem", { name: "Delete “Systems”…" }).click();
  await page.getByRole("alertdialog", { name: "Delete “Systems”?" }).getByRole("button", { name: "Delete profile" }).click();
  await expect(page.getByText("Deleted “Systems”.")).toBeVisible();
  await expect(switcher(page, "Senior Product Designer")).toBeVisible();
  expect(await sql(`SELECT name FROM "Profile"`)).toEqual([{ name: "Senior Product Designer" }]);
});

test("asks a profile without levels to choose them, and fills them with Guess with AI (E24-3)", async ({ page }) => {
  await sql(`UPDATE "Profile" SET "levelFrom" = NULL, "levelTo" = NULL`);
  await page.goto("/profile?section=experience");
  // The card under the meter says so (E33-1).
  const card = page.getByRole("link", { name: /^Jobs it's for\s*Choose the levels this profile is for/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("heading", { name: "Jobs it's for" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Guess with AI" }).click();
  await expect(page.getByRole("status").filter({ hasText: "For Mid level to Senior." })).toBeVisible();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("mid");
  await page.getByLabel("To", { exact: true }).selectOption("lead");
  await expect(page.getByRole("status").filter({ hasText: "For Mid level to Lead or director." })).toBeVisible();
  await expect.poll(async () => (await sql<{ levelTo: string }>(`SELECT "levelTo" FROM "Profile"`))[0]?.levelTo).toBe("lead");
  await page.goto("/profile?section=experience");
  await expect(page.getByRole("link", { name: /^Jobs it's for\s*Mid level/ })).toBeVisible();
  await expect(card).toHaveCount(0);

  // A new empty profile says which levels it's for from the start.
  await page.getByRole("button", { name: /^Profile: / }).click();
  await page.getByRole("menuitem", { name: "New profile…" }).click();
  const dialog = page.getByRole("dialog", { name: "New profile" });
  await dialog.getByLabel("Name").fill("Research");
  await dialog.getByLabel("From", { exact: true }).selectOption("senior");
  await dialog.getByLabel("To", { exact: true }).selectOption("senior");
  await dialog.getByRole("button", { name: "Make profile" }).click();
  await expect(page.getByRole("button", { name: "Profile: Research" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Jobs it's for\s*Senior · check where it wants to work/ })).toBeVisible();
});

test("asks to check where a profile wants to work until it's been looked at, and keeps the answers (E24-4)", async ({ page }) => {
  await resetData();
  await page.goto("/profile?section=basics");
  const card = page.getByRole("link", { name: /^Jobs it's for.*check where it wants to work/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("group", { name: "Ways of working it takes" })).toBeVisible();
  await expect(page.getByLabel("On-site and hybrid: how far from home")).toHaveValue("50");
  await expectAccessible(page);
  await page.getByLabel("On-site and hybrid: how far from home").selectOption("25");
  await page.getByRole("radio", { name: "Yes, to" }).click();
  await page.getByLabel("Where to").fill("Canada");
  await page.getByLabel("Where to").blur();
  await expect
    .poll(async () => (await sql<{ workplace: { radiusKm: number; relocatePlaces: string[] } }>(`SELECT workplace FROM "Profile"`))[0]?.workplace)
    .toMatchObject({ radiusKm: 25, relocate: true, relocatePlaces: ["Canada"] });
  await page.goto("/profile?section=basics");
  await expect(page.getByRole("link", { name: /^Jobs it's for/ })).toBeVisible();
  await expect(card).toHaveCount(0);
});

test("makes an application from the profile chosen in New application, which it remembers (E24-6)", async ({ page }) => {
  await resetData();
  await page.goto("/profile?section=basics");
  await switcher(page, "Senior Product Designer").click();
  await page.getByRole("menuitem", { name: "New profile…" }).click();
  await page.getByRole("dialog", { name: "New profile" }).getByLabel("Name").fill("Payments");
  await page.getByRole("radio", { name: "A copy" }).click();
  await page.getByRole("button", { name: "Make profile" }).click();
  await expect(switcher(page, "Payments")).toBeVisible();
  await sql(`UPDATE "Profile" SET summary = 'Designer of calm payment flows.' WHERE name = 'Payments'`);

  // The one last opened is chosen to start with; the other is a choice away.
  await page.goto("/new?fresh=1");
  const profile = page.getByLabel("Write from", { exact: true });
  await expect(profile.locator("option:checked")).toHaveText("Payments");
  await profile.selectOption({ label: "Senior Product Designer" });
  await profile.selectOption({ label: "Payments" });
  await fillPosting(page, "Ledgerly: Senior Product Designer, Payments. Strong prototyping skills in Figma.");
  await page.getByRole("button", { name: "Read the posting" }).click();
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeVisible();
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  // Its resume is tailored from that profile, and it says which one it's from.
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Designer of calm payment flows.");
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  await expect(page.getByRole("dialog", { name: "How you fit" })).toContainText("From “Payments”");
  expect(await sql(`SELECT p.name FROM "Application" a JOIN "Profile" p ON p.id = a."profileId" WHERE a.company = 'Ledgerly' ORDER BY a."createdAt" DESC LIMIT 1`)).toEqual([{ name: "Payments" }]);
});
