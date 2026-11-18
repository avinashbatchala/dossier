import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// Certifications (#293): their own section, on the base resume with how long
// they're valid and a link that opens, kept off resumes by a switch, and left
// out of one tailored resume and put back.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
});

test("adds a certification and shows it on the base resume", async ({ page }) => {
  await page.goto("/profile?section=certifications");
  await expect(page.getByRole("link", { name: /^Certifications\b.*1 certification/ })).toBeVisible();
  await page.getByRole("button", { name: "+ Add a certification" }).click();
  const name = page.getByRole("textbox", { name: "Certification" });
  await expect(name).toBeFocused();
  await name.fill("Professional Scrum Master I");
  await page.getByRole("textbox", { name: "Issued by" }).fill("Scrum.org");
  await page.getByRole("combobox", { name: "Obtained month" }).selectOption("March");
  await page.getByRole("textbox", { name: "Obtained year" }).fill("2024");
  await page.getByRole("textbox", { name: "Expires year" }).fill("2030");
  await page.getByLabel(/^Credential ID/).fill("PSM-778899");
  await page.getByLabel(/^Link/).fill("scrum.org/certificates/psm-778899");
  await page.getByLabel(/^Link/).blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /Professional Scrum Master I.*Scrum\.org.*Mar 2024/ })).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  const section = resume.locator("section", { has: page.getByRole("heading", { name: "Certifications" }) });
  await expect(section).toContainText("Professional Scrum Master I, Scrum.org");
  await expect(section).toContainText("Valid until 2030 · Credential ID PSM-778899 · scrum.org/certificates/psm-778899");
  await expect(section.getByRole("link", { name: "scrum.org/certificates/psm-778899" })).toHaveAttribute("href", "https://scrum.org/certificates/psm-778899");
  // The new one goes first, above the demo's.
  await expect(section.locator("[data-unit]").first()).toContainText("Professional Scrum Master I");

  // The PDF's link can be clicked.
  const pdf = (await (await page.request.get("/api/pdf?doc=base")).body()).toString("latin1");
  expect(pdf).toContain("https://scrum.org/certificates/psm-778899");
});

test("keeps a certification in the profile but off resumes", async ({ page }) => {
  await page.goto("/profile?section=certifications");
  await page.getByRole("button", { name: /^Professional Scrum Master I/, expanded: false }).click();
  await page.getByLabel("Show on resumes").uncheck();
  await page.getByLabel("Show on resumes").blur();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: /^Professional Scrum Master I.*Not on resumes/ })).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume).toContainText("Certified Accessibility Specialist");
  await expect(resume).not.toContainText("Professional Scrum Master I");
});

test("leaves a certification out of a tailored resume, and puts it back", async ({ page }) => {
  await page.goto(url);
  const certification = page.locator('[data-unit^="certification:"]');
  await expect(certification).toContainText("Certified Accessibility Specialist");
  await certification.hover();
  // Written by the candidate: no Regenerate or Ask AI.
  await expect(certification.getByRole("button")).toHaveText(["Edit", "Leave out"]);
  await certification.getByRole("button", { name: "Leave out" }).click();
  await expect(certification).toHaveCount(0);
  const notice = page.getByRole("note");
  await expect(notice).toContainText("Left out of this resume:");
  await expect(notice).toContainText("Certification “Certified Accessibility Specialist”");

  await page.reload();
  await expect(page.locator('[data-unit^="certification:"]')).toHaveCount(0);
  await page.getByRole("note").getByRole("button", { name: /^Put back the Certification/ }).click();
  await expect(page.locator('[data-unit^="certification:"]')).toContainText("Certified Accessibility Specialist");
  await expect(page.getByRole("note")).toHaveCount(0);
});
