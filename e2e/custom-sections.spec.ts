import { expect, test, type Page } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";

import { resetData, setProfileSetting, sql } from "./support";

// A resume's sections (#297, #298): reordered and removed on the Base resume
// with a live preview, sections made and filled in under Profile (#338), and
// an application's Sections menu, where a new section only arrives by Add.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
  // The demo's base theme may have a sidebar: these specs read one column.
  const [editorial] = await sql<{ id: string }>(`SELECT id FROM "Theme" WHERE name = 'Editorial' LIMIT 1`);
  await setProfileSetting("baseThemeId", editorial.id);
});

const titles = (page: Page) => page.getByRole("article", { name: "Resume" }).getByRole("heading", { level: 2 }).allTextContents();

test("moves and removes sections on the Base resume, and it stays that way", async ({ page }) => {
  await page.goto("/resume");
  await page.getByRole("tab", { name: "Sections" }).click();
  expect((await titles(page)).at(-2)).toBe("Skills");

  // By keyboard: Skills to the top, the way technical resumes often start.
  const up = page.getByRole("button", { name: "Move “Skills” up" });
  await up.focus();
  for (let moves = 0; moves < 6; moves++) await page.keyboard.press("Enter");
  await expect.poll(async () => (await titles(page)).indexOf("Skills")).toBeLessThan((await titles(page)).indexOf("Experience"));

  await page.getByRole("button", { name: "Remove Projects" }).click();
  await expect.poll(() => titles(page)).not.toContain("Projects");

  await page.waitForLoadState("networkidle");
  await page.goto("/resume?panel=sections");
  expect(await titles(page)).not.toContain("Projects");
  expect((await titles(page)).indexOf("Skills")).toBeLessThan((await titles(page)).indexOf("Experience"));

  // Dragging works too: Languages above Education.
  const row = (name: string) => page.locator("li", { has: page.getByRole("button", { name: `Move “${name}” up` }) });
  // The panel is taller than the window: the rows dragged between have to be on screen.
  await row("Languages").scrollIntoViewIfNeeded();
  const from = (await row("Languages").getByTitle("Drag to reorder").boundingBox())!;
  const to = (await row("Education").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await titles(page)).indexOf("Languages")).toBeLessThan((await titles(page)).indexOf("Education"));

  await page.getByRole("button", { name: "Put back Projects" }).click();
  await expect.poll(() => titles(page)).toContain("Projects");
});

test("makes a section on Profile and fills it in there, and switches its format", async ({ page }) => {
  await page.goto("/profile");
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "+ Add a section" }).click();
  await page.getByRole("button", { name: "Awards" }).click();
  await expect(page.getByRole("textbox", { name: "Section name" })).toHaveValue("Awards");
  await page.getByRole("button", { name: "Add section" }).click();

  // On to its page, listed among the profile's sections, without leaving Profile.
  await expect(page).toHaveURL(/\/profile\?section=custom/);
  await expect(page.getByRole("heading", { name: "Awards" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Awards\b.*Optional · none yet/ })).toBeVisible();
  await page.getByRole("button", { name: "+ Add an item" }).click();
  const text = page.getByRole("textbox", { name: "Text" });
  await expect(text).toBeFocused();
  await text.fill("**Best Paper**, CHI 2023");
  await page.getByLabel(/^Link/).fill("example.org/best-paper");
  await page.getByLabel(/^Link/).blur();
  await expect(page.getByText("Saved just now")).toBeVisible();

  await page.goto("/resume");
  const resume = page.getByRole("article", { name: "Resume" });
  const section = resume.locator("section", { has: page.getByRole("heading", { name: "Awards" }) });
  await expect(section.locator("strong")).toHaveText("Best Paper");
  await expect(section.getByRole("link", { name: "example.org/best-paper" })).toHaveAttribute("href", "https://example.org/best-paper");
  const pdf = (await (await page.request.get("/api/pdf?doc=base")).body()).toString("latin1");
  expect(pdf).toContain("https://example.org/best-paper");

  // Entries show the fields a line hid, which were kept.
  await page.goto("/profile");
  await page.getByRole("link", { name: /Awards/ }).click();
  await page.getByRole("radio", { name: "Entries" }).click();
  await page.getByRole("button", { name: /Best Paper/, expanded: false }).click();
  await expect(page.getByRole("textbox", { name: /Where or with whom/ })).toBeVisible();
  await expect(page.getByLabel(/^Link/)).toHaveValue("example.org/best-paper");
  await page.getByRole("radio", { name: "Lines" }).click();
  await page.getByRole("radio", { name: "Lines" }).blur();
  await expect(page.getByText("Saved just now")).toBeVisible();
});

test("an application gets a new section only when it's added", async ({ page }) => {
  await page.goto(url);
  const resume = page.getByRole("article", { name: "Resume" });
  await expect(resume.getByRole("heading", { name: "Awards" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Sections/ }).click();
  await page.getByRole("button", { name: "Add Awards" }).click();
  const line = resume.locator('[data-unit^="custom-line:"]');
  await expect(line).toContainText("Best Paper");

  // Word for word: it can be edited or left out, not rewritten by the AI.
  await page.keyboard.press("Escape");
  await line.hover();
  await expect(line.getByRole("button")).toHaveText(["Edit", "Leave out"]);

  // Its own order, without changing the base resume's.
  await page.getByRole("button", { name: /^Sections/ }).click();
  await page.getByRole("button", { name: "Remove Awards" }).click();
  await expect(resume.getByRole("heading", { name: "Awards" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Awards" }).click();
  await expect(resume.getByRole("heading", { name: "Awards" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/resume");
  await expect(page.getByRole("article", { name: "Resume" }).getByRole("heading", { name: "Awards" })).toBeVisible();
});

test("renames a heading on one resume, in the preview and the PDF, and back again (#339)", async ({ page }) => {
  await page.goto(url);
  const resume = page.getByRole("article", { name: "Resume" });
  await page.getByRole("button", { name: /^Sections/ }).click();
  await page.getByRole("button", { name: "Rename Experience" }).click();
  await page.getByRole("textbox", { name: "New heading for Experience" }).fill("Relevant experience");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(resume.getByRole("heading", { name: "Relevant experience" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use “Experience”" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForLoadState("networkidle");

  await page.reload();
  await expect(resume.getByRole("heading", { name: "Relevant experience" })).toBeVisible();
  const pdf = await page.request.get(`/api/pdf?doc=resume&application=${url.split("/").at(-1)}`);
  expect(pdf.ok()).toBe(true);
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await pdf.body())), { mergePages: true });
  expect(text).toContain("Relevant experience");

  // Only this resume.
  await page.goto("/resume");
  await expect(page.getByRole("article", { name: "Resume" }).getByRole("heading", { name: "Experience", exact: true })).toBeVisible();

  await page.goto(url);
  await page.getByRole("button", { name: /^Sections/ }).click();
  await page.getByRole("button", { name: "Use “Experience”" }).click();
  await expect(resume.getByRole("heading", { name: "Experience", exact: true })).toBeVisible();
});

test("deletes a section on its page, with Undo, and the Base resume only reorders and removes", async ({ page }) => {
  await page.goto("/resume?panel=sections");
  await expect(page.getByRole("button", { name: "Delete Awards" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a section" })).toHaveCount(0);
  await page.getByRole("link", { name: "Edit Awards" }).click();
  await expect(page.getByRole("heading", { name: "Awards" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Profile sections" });
  await page.getByRole("button", { name: "Delete this section" }).click();
  await expect(nav.getByRole("link", { name: /Awards/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Awards" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(nav.getByRole("link", { name: /Awards/ })).toBeVisible();
  await expect(page.getByText("Put back “Awards”.")).toBeVisible();

  await page.goto("/resume");
  await expect(page.getByRole("article", { name: "Resume" }).getByRole("heading", { name: "Awards" })).toBeVisible();
});
