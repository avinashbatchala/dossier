import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { FIRST_PROFILE, resetData, setProfileSetting, sql } from "./support";

// The theme builder (E5) and the PDF download (E5-5).
test.beforeAll(resetData);

test("builds a theme, makes it the base theme and downloads the resume as a PDF", async ({ page }) => {
  await page.goto("/resume");
  // A click before the page is live does nothing, so it's clicked until the builder opens.
  const accent = page.getByRole("radiogroup", { name: "Accent" });
  await expect(async () => {
    if (!(await accent.isVisible())) await page.getByRole("button", { name: /Make your own theme/ }).click();
    await expect(accent).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await accent.getByRole("radio", { name: "Green" }).click();
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

/** A PDF's Title, which Chromium writes as a literal string or, with other than ASCII in it, as UTF-16 in hex. */
function pdfTitle(pdf: Buffer): string | null {
  const found = /\/Title\s*(?:<([0-9A-Fa-f\s]*)>|\(((?:\\[\s\S]|[^\\)])*)\))/.exec(pdf.toString("latin1"));
  if (!found) return null;
  const bytes =
    found[1] !== undefined
      ? Buffer.from(found[1].replace(/\s/g, ""), "hex")
      : Buffer.from(
          found[2].replace(/\\([0-7]{1,3}|[\s\S])/g, (_, escaped: string) =>
            /^[0-7]+$/.test(escaped) ? String.fromCharCode(parseInt(escaped, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" } as Record<string, string>)[escaped] ?? escaped,
          ),
          "latin1",
        );
  if (bytes[0] !== 0xfe || bytes[1] !== 0xff) return bytes.toString("latin1");
  const swapped = Buffer.from(bytes.subarray(2));
  return swapped.swap16().toString("utf16le");
}

test("a PDF's title names the person and the document, which some viewers show instead of the file name (public issue 131)", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  const title = async (path: string) => pdfTitle(await (await page.request.get(path)).body());
  expect(await title("/api/pdf?doc=base")).toBe("Jane Doe – Resume");
  expect(await title(`/api/pdf?doc=resume&application=${ledgerly.id}`)).toBe("Jane Doe – Resume");
  expect(await title(`/api/pdf?doc=letter&application=${ledgerly.id}`)).toBe("Jane Doe – Cover letter");
});

test("Fit to one page downloads the resume itself, on one page (#328)", async ({ page }) => {
  const download = async () => (await (await page.request.get("/api/pdf?doc=base")).body()).toString("latin1");
  const pages = (pdf: string) => (pdf.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  // The demo certification's link, which no other page has: a page count alone
  // can't tell the resume from the sign-in page, which fits on one page too.
  const link = "https://verify.example.org/IDI-20481";

  const unfitted = await download();
  expect(pages(unfitted)).toBeGreaterThan(1);
  expect(unfitted).toContain(link);

  await setProfileSetting("fitBaseResume", "true");
  try {
    const fitted = await download();
    expect(pages(fitted)).toBe(1);
    expect(fitted).toContain(link);
  } finally {
    await setProfileSetting("fitBaseResume", null);
  }
});

test("keeps the summary's paragraphs, as typed in Profile → Summary (#277)", async ({ page }) => {
  const [{ value }] = await sql<{ value: string }>(`SELECT summary AS value FROM "Profile" WHERE id = ${FIRST_PROFILE}`);
  await sql(`UPDATE "Profile" SET summary = $1 WHERE id = ${FIRST_PROFILE}`, ["Designs calm tools for busy teams.\n\nLeads research from the first interview to the shipped screen."]);
  try {
    await page.goto("/resume");
    const summary = page.getByText(/^Designs calm tools for busy teams\./);
    await expect(summary).toHaveCSS("white-space", "pre-line");
    // Rendered text keeps the break only where the page shows it.
    expect(await summary.evaluate((element) => (element as HTMLElement).innerText)).toContain("\n");
  } finally {
    await sql(`UPDATE "Profile" SET summary = $1 WHERE id = ${FIRST_PROFILE}`, [value]);
  }
});
