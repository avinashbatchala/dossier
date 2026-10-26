import { expect, test } from "@playwright/test";

import { resetData } from "./support";

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
  await page.getByLabel("Job posting").fill(POSTING);
  await page.getByRole("button", { name: "Read the posting →" }).click();

  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await expect(page.getByLabel("Company")).toHaveValue("Ledgerly");
  await expect(page.getByLabel("Role")).toHaveValue("Senior Product Designer, Payments");
  await expect(page.getByText("Experience with Kubernetes")).toBeVisible();

  await page.getByLabel("Anything I should know?").fill("I'm moving to Amsterdam in January.");
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  await expect(page.getByRole("heading", { level: 1, name: "Senior Product Designer, Payments · Ledgerly" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await expect(page.getByText("Payments are where trust is won or lost")).toBeVisible();
  // What you told the AI is the application's first fact (APP-15).
  await page.getByRole("tab", { name: /Job posting/ }).click();
  await expect(page.getByRole("region", { name: "Facts for this application" }).getByRole("textbox", { name: "Fact 1", exact: true })).toHaveValue("I'm moving to Amsterdam in January.");
});

test("won't fetch a posting from the server's own network (E7-8)", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel(/^Link to the posting/).fill("http://localhost:3100/login");
  await page.getByRole("button", { name: "Fetch" }).click();
  await expect(page.getByText("Dossier doesn't fetch addresses on your own network. Paste the posting instead.")).toBeVisible();
  await expect(page.getByLabel("Job posting")).toHaveValue("");
});

