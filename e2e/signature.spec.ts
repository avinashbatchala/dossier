import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The uploaded signature (E17): Settings → Documents takes a PNG, and an
// application's Cover letter tab draws it once the letter is signed.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.beforeEach(async () => {
  await resetData();
});

test("uploads a PNG signature and signs a cover letter from its tab", async ({ page }) => {
  const [application] = await sql<{ id: string }>(
    `SELECT a.id FROM "Application" a JOIN "Document" d ON d."applicationId" = a.id WHERE d.kind = 'COVER_LETTER' LIMIT 1`,
  );
  expect(application).toBeTruthy();

  await page.goto("/settings?section=documents");
  await page.locator('input[type="file"]').setInputFiles({ name: "signature.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Your signature")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Sign new cover letters with this signature" })).not.toBeChecked();

  await page.goto(`/applications/${application.id}?tab=letter`);
  await expect(page.getByRole("switch", { name: "Sign this letter" })).toBeVisible();
  await page.getByRole("switch", { name: "Sign this letter" }).click();
  await expect(page.getByRole("switch", { name: "Signed" })).toBeVisible();

  const image = page.getByRole("article", { name: "Cover letter" }).locator("img");
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/);

  await expect.poll(async () => {
    const [row] = await sql<{ signed: boolean }>(`SELECT "signatureOnLetter" AS signed FROM "Application" WHERE id = $1`, [application.id]);
    return row.signed;
  }).toBe(true);
});

test("remembers the choice to sign new letters", async ({ page }) => {
  await page.goto("/settings?section=documents");
  await page.getByRole("checkbox", { name: "Sign new cover letters with this signature" }).click();
  await expect
    .poll(async () => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'signCoverLetters'`))[0]?.value)
    .toBe("true");
});
