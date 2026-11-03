import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The theme builder (E5) and the PDF download (E5-5).
test.beforeAll(resetData);

test("builds a theme, makes it the base theme and downloads the resume as a PDF", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("button", { name: /Make your own theme/ }).click();
  await page.getByRole("radiogroup", { name: "Accent" }).getByRole("radio", { name: "Green" }).click();
  await page.getByRole("radiogroup", { name: "Spacing" }).getByRole("radio", { name: "Compact" }).click();
  await page.getByLabel("Theme name").fill("Quiet green");
  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByRole("button", { name: "Quiet green theme, in use" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Quiet green theme, in use" })).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // Chromium's headless shell names every blob download "download", so the name is checked at the source.
  const response = await page.request.get("/api/pdf?doc=base");
  expect(response.headers()["content-disposition"]).toContain("filename*=UTF-8''Jane%20Doe%20%E2%80%93%20Resume.pdf");
});

test("keeps the summary's paragraphs, as typed in Profile → Basics (#277)", async ({ page }) => {
  const [{ value }] = await sql<{ value: string }>(`SELECT value FROM "ProfileField" WHERE key = 'summary'`);
  await sql(`UPDATE "ProfileField" SET value = $1 WHERE key = 'summary'`, ["Designs calm tools for busy teams.\n\nLeads research from the first interview to the shipped screen."]);
  try {
    await page.goto("/resume");
    const summary = page.getByText(/^Designs calm tools for busy teams\./);
    await expect(summary).toHaveCSS("white-space", "pre-line");
    // Rendered text keeps the break only where the page shows it.
    expect(await summary.evaluate((element) => (element as HTMLElement).innerText)).toContain("\n");
  } finally {
    await sql(`UPDATE "ProfileField" SET value = $1 WHERE key = 'summary'`, [value]);
  }
});
