import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// What employers ask for on the Profile page (E33-3): counted from saved
// postings scored for the profile, with Add and "I don't have this".

test.beforeAll(resetData);
test.afterAll(resetData);

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
}

/** A saved posting scored for the profile, asking for these skills. */
async function scored(id: string, company: string, skills: [string, boolean][]) {
  await sql(`INSERT INTO "Posting" (id, source, "externalId", company, title, "savedAt", "updatedAt") VALUES ($1, 'JSEARCH', $1, $2, 'Product Designer', now(), now())`, [id, company]);
  const [{ id: profileId }] = await sql<{ id: string }>(`SELECT id FROM "Profile" ORDER BY sort, "createdAt" LIMIT 1`);
  const requirements = skills.map(([skill, covered], index) => ({ text: `Line ${index}`, mustHave: true, covered, evidence: null, skill }));
  await sql(
    `INSERT INTO "PostingScore" (source, "externalId", "profileId", score, reasons, "redFlags", "scoredWith", breakdown, "updatedAt") VALUES ('JSEARCH', $1, $2, 70, '[]', '[]', 'score-posting@3', $3, now())`,
    [id, profileId, JSON.stringify({ factors: [], cap: null, requirements })],
  );
}

test("waits for enough postings, then lists the gaps, adds one to a role and hides another", async ({ page }) => {
  // Only these postings count: the demo application would too.
  await sql(`DELETE FROM "Application"`);
  await scored("p1", "Ledgerly", [["Kubernetes", false], ["Figma", true]]);
  await page.goto("/profile?section=experience");
  await expect(page.getByRole("region", { name: "What employers ask for" })).toContainText("Shows once 5 postings you saved or applied for are scored for this profile. 1 so far.");

  await scored("p2", "Adyen", [["Kubernetes", false], ["Payments", false], ["Figma", true]]);
  await scored("p3", "Finch Ledger", [["k8s", false], ["Payments", false]]);
  await scored("p4", "Mollie", [["Kubernetes", false], ["Figma", true]]);
  await scored("p5", "Bunq", [["React", false]]);
  await page.reload();
  const card = page.getByRole("region", { name: "Asked for, not in your profile" });
  await expect(card.getByRole("listitem")).toHaveText([
    // Who asks, newest first.
    /Kubernetes\s*In 4 postings · Mollie, Finch Ledger, Adyen…/,
    /Payments\s*In 2 postings · Finch Ledger, Adyen/,
    /React\s*In 1 posting · Bunq/,
  ]);

  // The sheet: the most asked, and whether the profile covers each.
  await card.getByRole("button", { name: /Asked for, not in your profile/ }).click();
  const sheet = page.getByRole("dialog", { name: "What employers ask for" });
  await expect(sheet.getByRole("listitem").first()).toContainText("Kubernetes, not in your profile4 of 5");
  await expect(sheet.getByRole("listitem").nth(1)).toContainText("Figma, in your profile3 of 5");
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Close" }).click();

  // Add: where it was used, and a line for that role.
  await card.getByRole("button", { name: "Add Kubernetes" }).click();
  const form = page.getByRole("group", { name: "Add Kubernetes to your profile" });
  await form.getByLabel("Where you used it").selectOption({ label: "Northwind Logistics, 2021 – now" });
  await form.getByLabel(/What you did with it/).fill("Moved the carrier portal's deploys to Kubernetes");
  await expectAccessible(page);
  await form.getByRole("button", { name: "Add to profile" }).click();
  await expect(page.getByText("Added “Kubernetes” to your profile, at Northwind Logistics.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Add Kubernetes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Senior Product Designer/ })).toContainText("Kubernetes");
  expect((await sql<{ bullets: string }>(`SELECT bullets FROM "Experience" WHERE company = 'Northwind Logistics'`))[0].bullets).toMatch(/Moved the carrier portal's deploys to Kubernetes$/);

  // "I don't have this" stays hidden after a reload.
  await card.getByRole("button", { name: "Add Payments" }).click();
  await page.getByRole("button", { name: "I don't have this" }).click();
  await expect(card.getByRole("button", { name: "Add Payments" })).toHaveCount(0);
  await expect(page.getByText("Noted. It won't come up here again for this profile.")).toBeVisible();
  await page.reload();
  await expect(card.getByRole("listitem")).toHaveText([/React\s*In 1 posting · Bunq/]);
});

test("asks the most recent role about the top gap, with Not here and Add a line (E33-4)", async ({ page }) => {
  await resetData();
  await sql(`DELETE FROM "Application"`);
  await scored("p1", "Ledgerly", [["Kubernetes", false]]);
  await scored("p2", "Adyen", [["Kubernetes", false], ["Payments", false]]);
  await scored("p3", "Finch Ledger", [["Kubernetes", false], ["Payments", false]]);
  await scored("p4", "Mollie", [["Kubernetes", false]]);
  await scored("p5", "Bunq", [["React", false]]);
  await page.goto("/profile?section=experience");

  // Only the most recent role asks.
  await page.getByRole("button", { name: /^Product Designer/ }).click();
  await expect(page.getByRole("group", { name: /^A question about/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Senior Product Designer/ }).click();
  const prompt = page.getByRole("group", { name: "A question about Kubernetes" });
  await expect(prompt).toHaveText("Mollie, Finch Ledger and 2 others ask about Kubernetes. Did anything at Northwind Logistics touch it? Only add it if it's true.Add a lineNot here");
  await expectAccessible(page);

  // Not here is kept for this role.
  await prompt.getByRole("button", { name: "Not here" }).click();
  await expect(page.getByRole("group", { name: "A question about Payments" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Senior Product Designer/ }).click();
  const payments = page.getByRole("group", { name: "A question about Payments" });
  await expect(payments).toContainText("Finch Ledger and Adyen ask about Payments.");

  // Add a line: into the role, with the skill.
  await payments.getByRole("button", { name: "Add a line" }).click();
  await payments.getByLabel("What you did with Payments at Northwind Logistics").fill("Rebuilt the carrier payouts flow");
  await payments.getByLabel("What you did with Payments at Northwind Logistics").press("Enter");
  await expect(page.getByText("Added “Payments” to your profile, at Northwind Logistics.")).toBeVisible();
  await expect(page.getByLabel("What you did", { exact: true })).toHaveValue(/Rebuilt the carrier payouts flow$/);
  await expect(page.getByRole("group", { name: "A question about React" })).toBeVisible();
  expect((await sql<{ bullets: string }>(`SELECT bullets FROM "Experience" WHERE company = 'Northwind Logistics'`))[0].bullets).toMatch(/Rebuilt the carrier payouts flow$/);
});
