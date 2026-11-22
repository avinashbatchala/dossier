import { expect, test, type Page } from "@playwright/test";

import { resetData } from "./support";

// Reordering experience (E4-9): by keyboard and by dragging, kept after a
// reload, followed by the resume, and back to date order.
test.beforeAll(resetData);

/** The role titles in the order the cards show them. */
const roles = (page: Page) =>
  // Not the profile switcher, whose menu button is expanded too (E24-2), nor the sidebar's toggles (E27).
  page.locator("main button[aria-expanded]:not([aria-haspopup])").evaluateAll((buttons) => buttons.map((button) => button.querySelector("span span")?.textContent));

test("moves roles by keyboard and by dragging, and the resume follows", async ({ page }) => {
  await page.goto("/profile?section=experience");
  expect(await roles(page)).toEqual(["Senior Product Designer", "Product Designer", "UX Designer"]);
  await expect(page.getByText(/^Newest first/)).toBeVisible();

  // Keyboard: the arrows.
  await page.getByRole("button", { name: "Move “UX Designer” up" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByText("“UX Designer” moved to position 1 of 3.")).toBeAttached();
  expect(await roles(page)).toEqual(["UX Designer", "Senior Product Designer", "Product Designer"]);
  await expect(page.getByText("In your own order.")).toBeVisible();

  // Pointer: drag Product Designer by its handle to the top.
  const card = page.locator("div.rounded-panel", { has: page.getByRole("button", { name: /^Product Designer/, expanded: false }) });
  const handle = card.getByTitle("Drag to reorder");
  const from = (await handle.boundingBox())!;
  const top = (await page.locator("button[aria-expanded]").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 20, { steps: 5 });
  await page.mouse.move(from.x + from.width / 2, top.y + 5, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => roles(page)).toEqual(["Product Designer", "UX Designer", "Senior Product Designer"]);

  // The new order shows at once; reload only once it's saved.
  await page.waitForLoadState("networkidle");
  await page.reload();
  expect(await roles(page)).toEqual(["Product Designer", "UX Designer", "Senior Product Designer"]);

  await page.goto("/resume");
  const resume = await page.getByRole("article", { name: "Resume" }).textContent();
  const at = (text: string) => resume!.indexOf(text);
  expect(at("Fieldnote")).toBeLessThan(at("Studio Brik"));
  expect(at("Studio Brik")).toBeLessThan(at("Northwind Logistics"));

  await page.goto("/profile?section=experience");
  await page.getByRole("button", { name: "Sort by date" }).click();
  await expect(page.getByText(/^Newest first/)).toBeVisible();
  expect(await roles(page)).toEqual(["Senior Product Designer", "Product Designer", "UX Designer"]);
});
