import { expect, test } from "@playwright/test";

import { portraitPng, resetData, sql } from "./support";

// The profile photo (#224): added and cropped in Basics, drawn on the base
// resume and its PDF in the theme's shape and place, kept off resumes or put
// on one application's, and removed with Undo.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
});

/**
 * A photo already in the profile, shown on resumes (#381): each test that
 * needs one sets it up itself, so none depends on the first one passing.
 */
async function withPhoto({ onResumes = true } = {}) {
  const photo = `data:image/png;base64,${portraitPng(480, 640).toString("base64")}`;
  for (const [key, value] of [["photo", photo], ["photoOnResumes", String(onResumes)]]) {
    await sql(`INSERT INTO "ProfileField" (key, value, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = $2, "updatedAt" = now()`, [key, value]);
  }
}

const pdfHasImage = async (page: import("@playwright/test").Page, path: string) =>
  (await (await page.request.get(path)).body()).toString("latin1").includes("/Subtype /Image");

test("adds a photo, cropped from the keyboard, and shows it on the base resume and its PDF", async ({ page }) => {
  await page.goto("/profile");
  // A file chosen before the page has hydrated is lost (the crop never opens).
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Photo file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: portraitPng() });
  const dialog = page.getByRole("dialog", { name: "Crop your photo" });
  const crop = dialog.getByRole("group", { name: /Photo crop/ });
  await crop.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("slider", { name: "Zoom" })).not.toHaveValue("1");
  await dialog.getByRole("button", { name: "Use photo" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("img", { name: "Your photo" })).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect(page.getByLabel("Show on resumes")).toBeChecked();
  const [stored] = await sql<{ value: string }>(`SELECT value FROM "ProfileField" WHERE key = 'photo'`);
  // Drawn anew at 480 × 640, so it's small, and the file's metadata is gone.
  expect(stored.value.length).toBeLessThan(200_000);

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  // Editorial: a circle at the end of the header.
  const photo = resume.getByRole("img", { name: "Jane Doe" });
  await expect(photo).toBeVisible();
  const box = (await photo.boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(await photo.evaluate((image) => getComputedStyle(image).borderRadius)).toBe("50%");
  expect(await pdfHasImage(page, "/api/pdf?doc=base")).toBe(true);
});

test("moves the photo with a click, without dragging (WCAG 2.5.7)", async ({ page }) => {
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Photo file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: portraitPng() });
  const crop = page.getByRole("dialog", { name: "Crop your photo" }).getByRole("group", { name: /Photo crop/ });
  const left = () => crop.locator("img").evaluate((image) => Number(/translate\((-?[\d.]+)px/.exec(image.style.transform)![1]));
  const before = await left();
  // Wider than the frame, so there's room to bring its left side in.
  await crop.click({ position: { x: 20, y: 160 } });
  expect(await left()).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Cancel" }).click();
});

test("takes the theme builder's shape and position", async ({ page }) => {
  await withPhoto();
  await page.goto("/resume");
  await page.getByRole("tab", { name: "Customize" }).click();
  await page.getByRole("radiogroup", { name: "Photo", exact: true }).getByRole("radio", { name: "Portrait" }).click();
  const positions = page.getByRole("radiogroup", { name: "Photo position" });
  // Editorial has no sidebar to put it in.
  await expect(positions.getByRole("radio")).toHaveText(["End of the header", "Start of the header", "Above the name"]);
  await positions.getByRole("radio", { name: "Start of the header" }).click();

  const resume = page.getByRole("article", { name: "Resume" });
  const photo = resume.getByRole("img", { name: "Jane Doe" });
  const box = (await photo.boundingBox())!;
  expect(box.height / box.width).toBeCloseTo(4 / 3, 1);
  const name = (await resume.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(box.x).toBeLessThan(name.x);

  await page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name: "Sidebar left" }).click();
  await positions.getByRole("radio", { name: "Top of the sidebar" }).click();
  const contact = (await resume.getByRole("heading", { name: "Contact" }).boundingBox())!;
  const inSidebar = (await photo.boundingBox())!;
  expect(inSidebar.y).toBeLessThan(contact.y);
  expect(Math.abs(inSidebar.x - contact.x)).toBeLessThan(1);

  await page.getByRole("button", { name: "Save theme" }).click();
  await expect(page.getByText("In use: My theme")).toBeVisible();
  const [theme] = await sql<{ photoShape: string; photoPosition: string }>(`SELECT "photoShape", "photoPosition" FROM "Theme" WHERE name = 'My theme'`);
  expect(theme).toEqual({ photoShape: "PORTRAIT", photoPosition: "SIDEBAR" });
});

test("keeps the photo off resumes, and puts it on one application's", async ({ page }) => {
  await withPhoto();
  await page.goto("/profile");
  await page.getByLabel("Show on resumes").uncheck();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.goto("/resume");
  await expect(page.getByRole("article", { name: "Resume" }).getByRole("img")).toHaveCount(0);

  await page.goto(url);
  const resume = page.getByRole("article", { name: "Resume" });
  // In the theme menu (E30-9).
  const photo = async () => {
    await page.getByRole("button", { name: /theme$/ }).click();
    return page.getByRole("menuitemcheckbox", { name: "Photo" });
  };
  const toggle = await photo();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(resume.getByRole("img")).toHaveCount(0);
  // The menu stays open, so the switch can go back as easily.
  await toggle.click();
  await expect(resume.getByRole("img", { name: "Jane Doe" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(await photo()).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  expect(await pdfHasImage(page, `/api/pdf?doc=resume&application=${ledgerly.id}`)).toBe(true);
});

test("removes the photo, and Undo puts it back", async ({ page }) => {
  await withPhoto({ onResumes: false });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Add a photo" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();
  // As it was: still off resumes.
  await expect(page.getByLabel("Show on resumes")).not.toBeChecked();

  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("button", { name: "Add a photo" })).toBeVisible();
  await expect.poll(async () => (await sql(`SELECT key FROM "ProfileField" WHERE key LIKE 'photo%'`)).length).toBe(0);
});
