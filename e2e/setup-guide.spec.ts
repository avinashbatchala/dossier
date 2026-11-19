import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// The setup guide (E21): it opens by itself on a fresh install, walks
// through each step, and holds the usage ping question back until it's left.
// Hosted AI keys aren't checked here: that would reach the vendors.
test.beforeEach(async ({ page }) => {
  await resetData();
  // Axe reads colours as they are (#381): a button's colour transition under the pointer, caught halfway, failed contrast now and then.
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  // Each with the elements it found, so a failure that doesn't repeat can still be traced.
  const serious = violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious.map((violation) => `${violation.id}: ${violation.nodes.map((node) => `${node.target.join(" ")} ${node.any[0]?.message ?? ""}`).join("; ")}`)).toEqual([]);
}

const freshInstall = async () => {
  await sql(`DELETE FROM "Application"`);
  await sql(`DELETE FROM "ProfileField" WHERE key = 'name'`);
  await sql(`DELETE FROM "Setting" WHERE key IN ('setupGuide', 'usagePingChoice', 'usagePingChoiceAt', 'usagePingChoiceText')`);
};

test("opens by itself on a fresh install and walks through every step", async ({ page }) => {
  await freshInstall();
  await page.goto("/");
  await expect(page).toHaveURL("/welcome");
  await expect(page.getByRole("heading", { name: "Welcome to Dossier" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Send a daily usage ping?" })).toHaveCount(0);
  await expectAccessible(page);

  // AI: the e2e server's is set in the environment, so it's done already.
  await page.getByRole("link", { name: "Let's start →" }).click();
  await expect(page.getByText(/Dossier already writes with OpenAI-compatible, using fake-model\. It's set on the server/)).toBeVisible();
  await page.getByRole("button", { name: "Choose another" }).click();
  await page.getByRole("radio", { name: "Best writing" }).click();
  await expect(page.getByRole("radio", { name: "OpenAI" })).toBeChecked();
  await expect(page.getByRole("list", { name: "Setting up OpenAI" }).getByRole("link", { name: /Open OpenAI's API keys/ })).toHaveAttribute("href", "https://platform.openai.com/api-keys");
  await page.getByRole("radio", { name: "Claude" }).click();
  await expect(page.getByText(/set it to Never expire/)).toBeVisible();
  await expectAccessible(page);

  // A model on this computer that isn't there: found nowhere, and nothing saved.
  await page.getByRole("radio", { name: "Free and private" }).click();
  await page.getByRole("button", { name: "Find LM Studio" }).click();
  await expect(page.getByText("Dossier couldn't find LM Studio.")).toBeVisible({ timeout: 30_000 });
  const [saved] = await sql<{ count: number }>(`SELECT count(*)::int AS count FROM "Setting" WHERE key = 'provider'`);
  expect(saved.count).toBe(0);
  await page.getByRole("link", { name: "Continue →" }).click();

  // Job search (E22-9): where and what, then JSearch ticked with a key, checked against the fake source.
  await expect(page.getByRole("heading", { name: "Where to look for jobs" })).toBeVisible();
  await page.getByRole("radio", { name: "Any kind of job" }).click();
  await page.getByRole("checkbox", { name: /^JSearch/ }).check();
  await page.getByLabel("JSearch API key").fill("e2e-jsearch-key");
  await page.getByRole("button", { name: "Check it" }).click();
  await expect(page.getByText("It works: Dossier can search JSearch.")).toBeVisible();
  await page.getByRole("link", { name: "Continue →" }).click();

  // Scoring: your AI is the choice already; the other scoring models come with their key steps and a check (E25-8).
  await expect(page.getByRole("radio", { name: "Your AI" })).toBeChecked();
  await expect(page.getByRole("radio")).toHaveCount(4);
  await page.getByRole("radio", { name: /^OpenRouter/ }).click();
  await expect(page.getByRole("list", { name: "Setting up OpenRouter" })).toBeVisible();
  await expect(page.getByLabel("OpenRouter key")).toBeVisible();
  await expect(page.getByLabel("Model")).toHaveAttribute("placeholder", "openai/gpt-6-luna");
  await page.getByRole("radio", { name: /^OpenAI Decisions/ }).click();
  await expect(page.getByLabel("OpenAI key")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("radio", { name: "Your AI" }).click();
  await expect(page.getByRole("radio", { name: "Your AI" })).toBeChecked();
  await page.getByRole("link", { name: "Continue →" }).click();

  // Google: the steps, the address to copy, and Connect once a client is saved.
  await expect(page.getByRole("heading", { name: "Gmail and Calendar" })).toBeVisible();
  await expect(page.getByText(/\/api\/google\/callback$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Google" })).toHaveAttribute("aria-disabled", "true");
  await expectAccessible(page);
  await page.getByRole("link", { name: "Skip this step →" }).click();

  // Profile: the import, inside the guide.
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.locator("input[type=file]")).toBeAttached();
  await page.getByRole("link", { name: "Skip this step →" }).click();

  // Done: what's set up, and the usage ping question once the guide is behind.
  await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: "JSearch" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fill in your profile" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the dashboard" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("dialog", { name: "Send a daily usage ping?" })).toBeVisible();
});

test("opens again from Settings, and leaving it goes back to the app for good", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/");
  await page.goto("/settings?section=about");
  await page.getByRole("link", { name: "Open the setup guide" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Dossier" })).toBeVisible();
  await page.getByRole("link", { name: "Let's start →" }).click();
  await page.getByRole("navigation", { name: "Setup steps" }).getByRole("link", { name: /Scoring/ }).click();
  await expect(page.getByRole("heading", { name: "How to judge a posting" })).toBeVisible();

  // Where it was left, until it's left for good. A step is saved after it shows (#381): go back once it is.
  await expect.poll(async () => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'setupGuide'`))[0]?.value ?? "").toContain("scoring");
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: "How to judge a posting" })).toBeVisible();
  await page.getByRole("button", { name: "Leave setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { name: "Welcome to Dossier" })).toBeVisible();
});
