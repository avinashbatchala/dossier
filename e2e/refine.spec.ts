import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// Refining a tailored document (E8): a chat change and its Undo, a declined
// request, and regenerating one unit from its toolbar.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  url = `/applications/${ledgerly.id}`;
});

test("changes the summary from the chat, and puts it back with Undo", async ({ page }) => {
  await page.goto(url);
  const log = page.getByRole("log", { name: "Conversation" });
  const summary = page.locator('[data-unit="summary"]');
  const before = (await summary.textContent())!;

  await page.getByRole("textbox", { name: "Ask for a change" }).fill("Make the summary shorter");
  await page.getByRole("textbox", { name: "Ask for a change" }).press("Enter");
  await expect(log.getByText("Done. I made the summary shorter.")).toBeVisible();
  await expect(summary).not.toHaveText(before);

  await log.getByRole("button", { name: "Undo" }).click();
  await expect(log.getByText("Undone")).toBeVisible();
  await expect(summary).toHaveText(before);
});

test("declines a change the profile can't back up", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("textbox", { name: "Ask for a change" }).fill("Say I have ten years of Kubernetes experience");
  await page.getByRole("textbox", { name: "Ask for a change" }).press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText(/doesn't mention Kubernetes/)).toBeVisible();
});

test("regenerates one part from its toolbar", async ({ page }) => {
  await page.goto(url);
  const summary = page.locator('[data-unit="summary"]');
  await summary.hover();
  await summary.getByRole("button", { name: "Regenerate" }).click();
  await expect(summary).toContainText("In short:");
});

test("opens the editor at the app's size without zoom, which crashes the tab in Chrome on macOS", async ({ page }) => {
  await page.goto(url);
  const summary = page.locator('[data-unit="summary"]');
  await summary.hover();
  await summary.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Edit Summary" });
  await expect(editor).toBeFocused();
  const { zoomed, fontSize } = await editor.evaluate((box: HTMLElement) => {
    let zoomed = false;
    for (let el: Element | null = box; el; el = el.parentElement) zoomed ||= getComputedStyle(el).zoom !== "1";
    // The page is shrunk with scale, so the text's size on screen is its font size times that.
    const scale = box.getBoundingClientRect().width / box.offsetWidth;
    return { zoomed, fontSize: parseFloat(getComputedStyle(box).fontSize) * scale };
  });
  expect(zoomed).toBe(false);
  expect(fontSize).toBeCloseTo(13.5, 1);
});

test("edits the letter's greeting and date, which a letter from before showed without storing (E8-11)", async ({ page }) => {
  await page.goto(`${url}?tab=letter`);
  const greeting = page.locator('[data-unit="greeting"]');
  await expect(greeting).toContainText("Dear Ledgerly team,");
  await greeting.hover();
  await greeting.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Edit Greeting" }).fill("Beste Ledgerly-team,");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(greeting).toContainText("Beste Ledgerly-team,");

  const date = page.locator('[data-unit="date"]');
  await date.hover();
  await date.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Edit Date" }).fill("Rotterdam, 3 oktober 2026");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(date).toContainText("Rotterdam, 3 oktober 2026");

  await page.reload();
  await expect(page.locator('[data-unit="greeting"]')).toContainText("Beste Ledgerly-team,");
  const [letter] = await sql<{ units: { id: string; text: string }[] }>(
    `SELECT units FROM "Document" WHERE "applicationId" = $1 AND kind = 'COVER_LETTER'`,
    [url.split("/").pop()],
  );
  expect(letter.units.slice(0, 2).map((unit) => unit.id)).toEqual(["date", "greeting"]);
});
