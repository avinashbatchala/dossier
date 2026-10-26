import { expect, test } from "@playwright/test";

import { lastPrompt, resetData, sql } from "./support";

// Facts for the AI (PRO-14, APP-15): the profile's own, an application's on
// its Job posting tab, and both in the prompt when a part is rewritten.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
});

test("adds, edits and removes facts about me, kept after a reload", async ({ page }) => {
  await page.goto("/profile?section=facts");
  const facts = page.getByRole("list", { name: "Facts" });
  await expect(page.getByRole("link", { name: /Facts about me\s*optional\s*2/ })).toBeVisible();
  await expect(facts.getByRole("textbox")).toHaveCount(2);

  await page.getByRole("button", { name: "+ Add a fact" }).click();
  await expect(page.getByRole("textbox", { name: "Fact 3", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Fact 3", exact: true }).fill("I spent a year at Klarna before design school.");
  await page.getByRole("textbox", { name: "Fact 1", exact: true }).fill("I'd like to stay close to user research and accessibility.");
  await page.getByRole("textbox", { name: "Fact 1", exact: true }).blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.getByRole("button", { name: "Remove fact 2" }).click();
  await expect(page.getByText("Removed a fact.")).toBeVisible();
  await expect(facts.getByRole("textbox")).toHaveCount(2);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Fact 1", exact: true })).toHaveValue("I'd like to stay close to user research and accessibility.");
  await expect(page.getByRole("textbox", { name: "Fact 2", exact: true })).toHaveValue("I spent a year at Klarna before design school.");
  await expect(page.getByRole("link", { name: /Facts about me\s*optional\s*2/ })).toBeVisible();
});

test("adds a fact for one application on its Job posting tab, and the AI gets both kinds", async ({ page }) => {
  await page.goto(`${url}?tab=posting`);
  const card = page.getByRole("region", { name: "Facts for this application" });
  await expect(card.getByRole("link", { name: "Facts about me" })).toHaveAttribute("href", "/profile?section=facts");
  await expect(card.getByRole("textbox", { name: "Fact 1", exact: true })).toHaveValue(/freelance invoicing/);
  await card.getByRole("button", { name: "+ Add a fact" }).click();
  await card.getByRole("textbox", { name: "Fact 2", exact: true }).fill("I gave a talk at Config last year.");
  await card.getByRole("textbox", { name: "Fact 2", exact: true }).blur();

  // Kept while switching tabs, which doesn't reload the page.
  await page.getByRole("tab", { name: "Resume" }).click();
  await page.getByRole("tab", { name: /Job posting/ }).click();
  await expect(card.getByRole("textbox", { name: "Fact 2", exact: true })).toHaveValue("I gave a talk at Config last year.");

  await page.getByRole("tab", { name: "Resume" }).click();
  const summary = page.locator('[data-unit="summary"]');
  await summary.hover();
  await summary.getByRole("button", { name: "Regenerate" }).click();
  await expect(summary).toContainText("In short:");
  const prompt = await lastPrompt();
  expect(prompt).toContain('"factsAboutMe": [');
  expect(prompt).toContain("I spent a year at Klarna before design school.");
  expect(prompt).toContain("What the candidate tells you for this application:\n- I've used Ledgerly for my own freelance invoicing");
  expect(prompt).toContain("- I gave a talk at Config last year.");
});
