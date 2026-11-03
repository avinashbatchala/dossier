import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { docxWith } from "../src/test/resume-files";

import { resetData } from "./support";

// Importing a profile from a resume file (E4-10), with the fake AI server:
// reading, the preview, merging and replacing.
test.beforeEach(resetData);

const RESUME = docxWith([
  "John Doe",
  "Design Lead in Utrecht · robin@example.com",
  "Experience",
  "Design Lead, Acme Payments, Utrecht, March 2021 – present",
  "Payouts for online marketplaces, 60 people",
  "Led the redesign of the payout flow",
  "Skills: Figma",
  "Languages: Dutch (native)",
]);

async function readResume(page: Page) {
  await page.goto("/profile");
  await page.getByRole("link", { name: "Import from a resume" }).click();
  await expect(page).toHaveURL("/profile/import");
  await page.getByLabel("Your resume, as PDF, Word (.docx) or Markdown (.md)").setInputFiles({
    name: "resume.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(RESUME),
  });
  await page.getByRole("button", { name: "Read my resume →" }).click();
  await expect(page.getByRole("heading", { name: "Here's what your resume says" })).toBeFocused();
}

test("says which files it takes", async ({ page }) => {
  await page.goto("/profile/import");
  const file = page.getByLabel("Your resume, as PDF, Word (.docx) or Markdown (.md)");
  await file.setInputFiles({ name: "resume.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]) });
  await page.getByRole("button", { name: "Read my resume →" }).click();
  await expect(page.getByText("Choose a PDF, a Word (.docx) or a Markdown (.md) file.")).toBeVisible();
  await file.setInputFiles({ name: "resume.md", mimeType: "text/markdown", buffer: Buffer.from("# John Doe") });
  await page.getByRole("button", { name: "Read my resume →" }).click();
  await expect(page.getByText("There's hardly any text in that file. Choose the one with your whole resume.")).toBeVisible();
});

test("reads a resume, shows what it found and merges it into the profile", async ({ page }) => {
  await readResume(page);
  await expect(page).toHaveURL(/\/profile\/import\?job=/);
  const preview = page.locator("section", { has: page.getByRole("heading", { name: "Experience" }) });
  await expect(preview).toContainText("Design Lead · Acme Payments");
  await expect(preview).toContainText("Payouts for online marketplaces, 60 people");
  await expect(preview).toContainText("Led the redesign of the payout flow");
  // "Service design" isn't in the file.
  await expect(page.locator("li", { hasText: "Service design" })).toContainText("check");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await page.getByRole("button", { name: "Merge into my profile" }).click();
  await expect(page).toHaveURL("/profile");
  await expect(page.getByText(/^Added to your profile: 1 role, 0 projects, 0 degrees, 2 skills, 1 language, 0 references\./)).toBeVisible();
  // What the resume says wins; the demo profile's other roles stay.
  await expect(page.getByLabel("Full name")).toHaveValue("John Doe");
  await page.goto("/profile?section=experience");
  await expect(page.getByRole("button", { name: /^Design Lead.*Acme Payments/, expanded: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Senior Product Designer.*Northwind/, expanded: false })).toBeVisible();
});

test("replaces the profile after asking", async ({ page }) => {
  await readResume(page);
  await page.getByRole("button", { name: "Replace my profile…" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Replace my profile" }).click();
  await expect(page).toHaveURL("/profile");
  await page.goto("/profile?section=experience");
  await expect(page.locator("button[aria-expanded]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Design Lead.*Acme Payments/, expanded: false })).toBeVisible();
});

test("reads a PDF too: Dossier's own base resume", async ({ page }) => {
  const pdf = await (await page.request.get("/api/pdf?doc=base")).body();
  await page.goto("/profile/import");
  await page.getByLabel("Your resume, as PDF, Word (.docx) or Markdown (.md)").setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Read my resume →" }).click();
  await expect(page.getByRole("heading", { name: "Here's what your resume says" })).toBeVisible();
});

test("reads Markdown too", async ({ page }) => {
  const markdown = [
    "# John Doe",
    "Design Lead in Utrecht · [robin@example.com](mailto:robin@example.com)",
    "",
    "## Experience",
    "### Design Lead, **Acme Payments**, Utrecht, March 2021 – present",
    "- Led the redesign of the payout flow",
    "",
    "**Skills:** Figma · **Languages:** Dutch (native)",
  ].join("\n");
  await page.goto("/profile/import");
  await page.getByLabel("Your resume, as PDF, Word (.docx) or Markdown (.md)").setInputFiles({ name: "resume.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) });
  await page.getByRole("button", { name: "Read my resume →" }).click();
  await expect(page.getByRole("heading", { name: "Here's what your resume says" })).toBeVisible();
  const preview = page.locator("section", { has: page.getByRole("heading", { name: "Experience" }) });
  await expect(preview).toContainText("Design Lead · Acme Payments");
  await expect(preview).toContainText("Led the redesign of the payout flow");
});
