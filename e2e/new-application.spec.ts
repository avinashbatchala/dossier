import { expect, test } from "@playwright/test";

import { fillPosting, resetData } from "./support";

// A new application from a pasted posting (E7), with the fake AI server.
test.beforeAll(resetData);

const POSTING = `Ledgerly: Senior Product Designer, Payments
Amsterdam (hybrid, 3 days in office) · €75,000–€90,000

What we're looking for
- 5+ years of product design
- You've built or maintained a design system
- Strong prototyping skills in Figma
- Experience with Kubernetes
- Dutch is a plus`;

test("reads a posting, shows the match and writes tailored documents", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await fillPosting(page, POSTING);
  await page.getByRole("button", { name: "Read the posting" }).click();

  // The review, in the application's frame (E31-3).
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Senior Product Designer, Payments at Ledgerly" })).toBeVisible();
  await expect(page).toHaveURL(/\/new\?step=review$/);
  // How you fit, from the scoring engine (E25-7): Kubernetes is a must-have gap, which caps the score.
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  const fit = page.getByRole("dialog", { name: "How you fit" });
  const kubernetes = fit.getByRole("listitem").filter({ hasText: "Experience with Kubernetes" });
  await expect(kubernetes).toContainText("must-have");
  await expect(kubernetes.getByRole("button", { name: "Add to profile" })).toBeVisible();
  await fit.getByText("How it fits, in more ways · Why?").click();
  await expect(fit.getByText("“Experience with Kubernetes” is a must-have you don't show.")).toBeVisible();
  await page.keyboard.press("Escape");
  // The posting, with each requirement marked where it says it.
  await page.getByRole("button", { name: "Show the posting" }).click();
  await expect(page.getByRole("region", { name: /^The posting/ }).locator("mark", { hasText: "Experience with Kubernetes" })).toBeVisible();

  await page.getByLabel("Anything I should know?").fill("I'm moving to Amsterdam in January.");
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  await expect(page.getByRole("heading", { level: 1, name: "Senior Product Designer, Payments at Ledgerly" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await expect(page.getByText("Payments are where trust is won or lost")).toBeVisible();
  // What you told the AI is the application's first fact (APP-15).
  await page.getByRole("tab", { name: /Job posting/ }).click();
  await expect(page.getByRole("region", { name: "Facts for this application" }).getByRole("textbox", { name: "Fact 1", exact: true })).toHaveValue("I'm moving to Amsterdam in January.");
});

test("adds an application sent before Dossier, without documents (public #129)", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await fillPosting(page, POSTING);
  await page.getByRole("button", { name: "Add it to keep track" }).click();
  const form = page.getByRole("form", { name: "Already sent" });
  await form.getByLabel("Company").fill("Northwind");
  await form.getByLabel("Role").fill("Product Designer");
  await form.getByLabel("Sent on").fill("2026-09-01");
  await form.getByLabel("Where it stands").selectOption("Screening");
  await form.getByRole("button", { name: "Add application" }).click();
  await page.waitForURL(/\/applications\/c/);

  await expect(page.getByRole("heading", { level: 1, name: "Product Designer at Northwind" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Status: Screening" })).toBeVisible();
});

test("counts the tokens it used on the Usage screen (#290)", async ({ page }) => {
  await page.goto("/usage");
  await expect(page.getByRole("heading", { level: 1, name: "Usage" })).toBeVisible();
  // One reading of the posting, as the fake AI server counts every answer.
  const reading = page.getByRole("row", { name: /^Reading postings/ });
  await expect(reading.getByRole("cell")).toHaveText(["1", "1,200", "300", "1,500"]);
  await expect(page.getByRole("row", { name: /^Writing resumes/ }).getByRole("cell").first()).toHaveText("1");
  await expect(page.getByText(/^Counting since/)).toBeVisible();
});

test("won't fetch a posting from the server's own network (E7-8)", async ({ page }) => {
  await page.goto("/new?fresh=1");
  // Filled until it holds: the page may still be coming live, or clearing the draft ?fresh=1 asks for.
  const fetch = page.getByRole("button", { name: "Fetch" });
  await expect(async () => {
    await page.getByLabel(/^Link to the posting/).fill("http://localhost:3100/login");
    await expect(fetch).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await fetch.click();
  await expect(page.getByText("Dossier doesn't fetch addresses on your own network. Paste the posting instead.")).toBeVisible();
  await expect(page.getByLabel("Job posting")).toHaveValue("");
});

