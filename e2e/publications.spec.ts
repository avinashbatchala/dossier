import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// Publications (#218): written in your own style with bold and italics, on the
// base resume with a link that opens, kept off resumes by a switch, and left
// out of one tailored resume and put back (#217).
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
});

test("adds a publication with italics and a DOI, and shows it on the base resume", async ({ page }) => {
  await page.goto("/profile?section=publications");
  await expect(page.getByRole("link", { name: /Publications\s*optional\s*1/ })).toBeVisible();
  await page.getByRole("button", { name: "+ Add a publication" }).click();
  const citation = page.getByRole("textbox", { name: "Citation" });
  await expect(citation).toBeFocused();
  await citation.fill("Doe, J. (2024). Calm payouts. Journal of Studies, 12(3), 45–67.");
  // "Journal of Studies" in italics, from the keyboard.
  await citation.evaluate((box: HTMLTextAreaElement) => {
    const start = box.value.indexOf("Journal of Studies");
    box.setSelectionRange(start, start + "Journal of Studies".length);
  });
  await page.keyboard.press("Control+i");
  await expect(citation).toHaveValue("Doe, J. (2024). Calm payouts. *Journal of Studies*, 12(3), 45–67.");
  await page.getByLabel(/^Link/).fill("10.5555/98765");
  await page.getByLabel(/^Link/).blur();
  await expect(page.getByLabel(/^Link/)).toHaveValue("https://doi.org/10.5555/98765");
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Doe, J\. \(2024\)\. Calm payouts.*doi\.org\/10\.5555\/98765/ })).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  const section = resume.locator("section", { has: page.getByRole("heading", { name: "Publications" }) });
  await expect(section).toContainText("Doe, J. (2024). Calm payouts. Journal of Studies, 12(3), 45–67. doi.org/10.5555/98765");
  await expect(section.locator("em", { hasText: "Journal of Studies" })).toBeVisible();
  await expect(section.getByRole("link", { name: "doi.org/10.5555/98765" })).toHaveAttribute("href", "https://doi.org/10.5555/98765");
  // The new one goes first, above the demo's.
  await expect(section.locator("[data-unit]").first()).toContainText("Calm payouts");

  // The PDF's link can be clicked.
  const pdf = (await (await page.request.get("/api/pdf?doc=base")).body()).toString("latin1");
  expect(pdf).toContain("https://doi.org/10.5555/98765");
});

test("keeps a publication in the profile but off resumes", async ({ page }) => {
  await page.goto("/profile?section=publications");
  await page.getByRole("button", { name: /^Doe, J\. \(2024\)\. Calm payouts/, expanded: false }).click();
  await page.getByLabel("Show on resumes").uncheck();
  await page.getByLabel("Show on resumes").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Doe, J\. \(2024\)\. Calm payouts.*Not on resumes/ })).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume).toContainText("Trust in automated scheduling");
  await expect(resume).not.toContainText("Calm payouts");
});

test("leaves a publication out of a tailored resume, and puts it back", async ({ page }) => {
  await page.goto(url);
  const publication = page.locator('[data-unit^="publication:"]');
  await expect(publication).toContainText("Trust in automated scheduling");
  await publication.hover();
  // Written by the candidate: no Regenerate or Ask AI.
  await expect(publication.getByRole("button")).toHaveText(["Edit", "Leave out"]);
  await publication.getByRole("button", { name: "Leave out" }).click();
  await expect(publication).toHaveCount(0);
  const notice = page.getByRole("note");
  await expect(notice).toContainText("Left out of this resume:");
  await expect(notice).toContainText("Publication “Doe, J., & Vermeer, K. (2016). Trust in…”");

  await page.reload();
  await expect(page.locator('[data-unit^="publication:"]')).toHaveCount(0);
  await page.getByRole("note").getByRole("button", { name: /^Put back the Publication/ }).click();
  await expect(page.locator('[data-unit^="publication:"]')).toContainText("Trust in automated scheduling");
  await expect(page.getByRole("note")).toHaveCount(0);
});
