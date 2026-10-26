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

const pdfHasImage = async (page: import("@playwright/test").Page, path: string) =>
  (await (await page.request.get(path)).body()).toString("latin1").includes("/Subtype /Image");

test("adds a photo, cropped from the keyboard, and shows it on the base resume and its PDF", async ({ page }) => {
  await page.goto("/profile");
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

test("takes the theme builder's shape and position", async ({ page }) => {
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
  await page.goto("/profile");
  await page.getByLabel("Show on resumes").uncheck();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.goto("/resume");
  await expect(page.getByRole("article", { name: "Resume" }).getByRole("img")).toHaveCount(0);

  await page.goto(url);
  const resume = page.getByRole("article", { name: "Resume" });
  const toggle = page.getByRole("switch", { name: "Photo" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(resume.getByRole("img")).toHaveCount(0);
  await toggle.click();
  await expect(resume.getByRole("img", { name: "Jane Doe" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Photo" })).toHaveAttribute("aria-checked", "true");
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  expect(await pdfHasImage(page, `/api/pdf?doc=resume&application=${ledgerly.id}`)).toBe(true);
});

test("removes the photo, and Undo puts it back", async ({ page }) => {
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
