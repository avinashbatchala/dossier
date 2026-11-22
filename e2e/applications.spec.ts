import { expect, test, type Locator, type Page } from "@playwright/test";

import { resetData, sql } from "./support";

// Moving applications through the pipeline (E9): dragging on the board, the
// keyboard alternative, and the table's status select; and the board keeping
// to the window.
test.beforeEach(resetData);

const column = (page: Page, name: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });

test("drags a card to another column", async ({ page }) => {
  await page.goto("/applications");
  const card = column(page, "Sent").locator("li", { hasText: "Kestrel Maps" });
  const from = (await card.boundingBox())!;
  const to = (await column(page, "Screening").boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + 30);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 4 });
  await page.mouse.move(to.x + 120, to.y + 200, { steps: 12 });
  await page.mouse.up();

  await expect(column(page, "Screening")).toContainText("Kestrel Maps");
  await expect(page.getByText("In screening. They're taking a look.")).toBeVisible();
  await page.reload();
  await expect(column(page, "Screening")).toContainText("Kestrel Maps");
});

// Reordering within a column (public issue 60). Sent holds these two, newest first.
const ONBOARDING = "Product Designer, Onboarding";
const MOBILE = "Product Designer, Mobile";
/** Each card's role: its first link, before the next-step button (E29-4). */
const titles = (page: Page, name: string) =>
  column(page, name)
    .getByRole("listitem")
    .evaluateAll((cards) => cards.map((card) => card.querySelector("a")?.textContent ?? ""));
const card = (page: Page, name: string, title: string) => column(page, name).getByRole("listitem").filter({ hasText: title });

/** Drags a locator's middle to a point, pausing there like a person so the drop lands where it looks. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await page.waitForTimeout(200);
  await page.mouse.up();
}
/**
 * Opens the board and waits until dragging works (#332): dnd-kit renders its
 * hidden instructions (id "applications-board", the board's DndContext id)
 * only once the page has hydrated. A drag before that does nothing, which
 * made the drag tests fail now and then.
 */
async function openBoard(page: Page) {
  await page.goto("/applications");
  await expect(page.locator("#applications-board")).toBeAttached();
}
const middle = async (locator: Locator) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

test("drags a card within its column and keeps the order, without changing when it was updated", async ({ page }) => {
  const updated = () => sql(`SELECT id, "updatedAt" FROM "Application" ORDER BY id`);
  const before = await updated();
  await openBoard(page);
  await expect.poll(() => titles(page, "Sent")).toEqual([ONBOARDING, MOBILE]);

  await drag(page, card(page, "Sent", MOBILE), await middle(card(page, "Sent", ONBOARDING)));
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);

  await page.reload();
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);
  expect(await updated()).toEqual(before);
});

test("reorders a card from the keyboard, with focus back on its menu button", async ({ page }) => {
  await openBoard(page);
  const button = page.getByRole("button", { name: /^Actions for Product Designer, Onboarding, Meridian Bank/ });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Move up" })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("menuitem", { name: "Move down" }).focus();
  await page.keyboard.press("Enter");

  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);
  await expect(button).toBeFocused();
  await page.reload();
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);
});

test("puts a card dropped on another column's card on top of it", async ({ page }) => {
  await openBoard(page);
  await drag(page, card(page, "Sent", ONBOARDING), await middle(column(page, "Interview").getByRole("listitem").first()));
  await expect.poll(async () => (await titles(page, "Interview"))[0]).toBe(ONBOARDING);
  await expect(column(page, "Interview").getByRole("listitem")).toHaveCount(2);

  await page.reload();
  await expect.poll(async () => (await titles(page, "Interview"))[0]).toBe(ONBOARDING);
});

test("takes a moved card back to its place with Undo", async ({ page }) => {
  await sql(`UPDATE "Application" SET "boardSort" = CASE WHEN company = 'Kestrel Maps' THEN 0 ELSE 1 END WHERE status = 'SENT'`);
  await openBoard(page);
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);

  await drag(page, card(page, "Sent", ONBOARDING), await middle(column(page, "Interview").getByRole("listitem").first()));
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => titles(page, "Sent")).toEqual([MOBILE, ONBOARDING]);
});

test("moves a card to an empty column from near its top", async ({ page }) => {
  await sql(`DELETE FROM "Application" WHERE status = 'SCREENING'`);
  await openBoard(page);
  const to = (await column(page, "Screening").boundingBox())!;
  await drag(page, card(page, "Sent", ONBOARDING), { x: to.x + to.width / 2, y: to.y + 40 });
  await expect(column(page, "Screening")).toContainText(ONBOARDING);
});

test("moves a card dropped with the pointer between two columns", async ({ page }) => {
  await openBoard(page);
  const screening = (await column(page, "Screening").boundingBox())!;
  await drag(page, card(page, "Sent", ONBOARDING), { x: screening.x + screening.width + 7, y: screening.y + 200 });
  await expect(column(page, "Sent")).not.toContainText(ONBOARDING);
});

test("keeps the whole card menu within reach in a short window", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 640 });
  await page.goto("/applications");
  await page.getByRole("button", { name: /^Actions for Product Designer, Mobile, Kestrel Maps/ }).click();
  const remove = page.getByRole("menuitem", { name: "Delete…" });
  await remove.scrollIntoViewIfNeeded();
  await expect(remove).toBeInViewport({ ratio: 1 });
});

test("leaves everything alone when a card is dropped off the columns", async ({ page }) => {
  const statuses = () => sql(`SELECT id, status, "boardSort" FROM "Application" ORDER BY id`);
  const before = await statuses();
  await openBoard(page);
  await expect.poll(() => titles(page, "Sent")).toEqual([ONBOARDING, MOBILE]);

  // Below the columns' tops, over the sidebar.
  await drag(page, card(page, "Sent", ONBOARDING), { x: 60, y: 880 });
  await page.waitForTimeout(500);
  await expect.poll(() => titles(page, "Sent")).toEqual([ONBOARDING, MOBILE]);
  expect(await statuses()).toEqual(before);
});

test("moves a card from the keyboard", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: /^Actions for Product Designer, Mobile, Kestrel Maps/ }).focus();
  await page.keyboard.press("Enter");
  // Radix moves focus to the first item once the menu is open.
  await expect(page.getByRole("menuitemradio").first()).toBeFocused();
  const interview = page.getByRole("menuitemradio", { name: /Interview/ });
  for (let step = 0; step < 12 && !(await interview.evaluate((item) => item === document.activeElement)); step++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(interview).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(column(page, "Interview")).toContainText("Kestrel Maps");
});

test("changes a status in the table", async ({ page }) => {
  await page.goto("/applications?view=table");
  await page.getByLabel("Status of Product Designer, Mobile, Kestrel Maps").selectOption("SCREENING");
  await expect(page.getByText("In screening. They're taking a look.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Status of Product Designer, Mobile, Kestrel Maps")).toHaveValue("SCREENING");
});

test("keeps the board to the window, each column scrolling on its own", async ({ page }) => {
  await sql(
    `INSERT INTO "Application" (id, title, company, role, status, "updatedAt")
     SELECT 'filler-' || n, 'Designer · Filler ' || n, 'Filler ' || n, 'Designer', 'SENT', now() - n * interval '1 hour'
     FROM generate_series(1, 14) AS n`,
  );
  await page.goto("/applications");
  const cards = column(page, "Sent").getByRole("list");
  await expect(cards).toContainText("Filler 14");
  const last = cards.getByRole("listitem").last();

  // The page doesn't scroll; the column does, and its heading stays.
  expect(await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeLessThanOrEqual(0);
  expect(await cards.evaluate((list) => list.scrollHeight - list.clientHeight)).toBeGreaterThan(0);
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(column(page, "Sent").getByRole("heading", { name: /^Sent/ })).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("a status opens as its own list, and remembers Board once it's chosen there (E29-1, E29-2, LB1)", async ({ page }) => {
  await page.goto("/applications?status=sent");
  await expect(page.getByRole("heading", { level: 1, name: "Sent" })).toBeVisible();
  await expect(page.getByText(/^2 waiting to hear back\./)).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveText(["Application", "Sent", "Quiet for", "Match", "Next step", "Actions"]);
  await expect(page.getByRole("navigation", { name: "Statuses" }).getByRole("link", { name: /^Sent/ })).toHaveAttribute("aria-current", "page");

  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page).toHaveURL(/status=sent&view=board/);
  // The board keeps every lane, with Sent picked out (E29-6).
  await expect(column(page, "Sent")).toHaveAttribute("aria-current", "true");
  await page.goto("/applications?status=sent");
  await expect(column(page, "Sent")).toHaveAttribute("aria-current", "true");
  // Other statuses still open as a list.
  await page.goto("/applications?status=draft");
  await expect(page.getByRole("columnheader", { name: "Apply by" })).toBeVisible();
});

test("asks when the interview is after a card is dropped on Interview (E29-5)", async ({ page }) => {
  await openBoard(page);
  await drag(page, card(page, "Sent", ONBOARDING), await middle(column(page, "Interview").getByRole("listitem").first()));
  const dialog = page.getByRole("dialog", { name: "When's the interview?" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Date and time").fill("2030-11-19T14:00");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Interview date saved. It'll show on your dashboard.")).toBeVisible();
  await expect.poll(async () => (await sql<{ at: Date | null }>(`SELECT "nextInterviewAt" AS at FROM "Application" WHERE role = '${ONBOARDING}'`))[0].at).not.toBeNull();
});

test("Mark as sent asks how it went out, and says so (E29-7)", async ({ page }) => {
  const [draft] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  // With the email, where sending finishes (E30-2).
  await page.goto(`/applications/${draft.id}?tab=email`);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByRole("menuitem", { name: "By email" }).click();
  await expect(page.getByText("Marked as sent. Fingers crossed!")).toBeVisible();
  await page.reload();
  // In the Fit column, which opens from its rail at this width (E30-3).
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  await expect(page.getByRole("dialog", { name: "How you fit" })).toContainText(/Sent \d{1,2} \w{3} by email/);
  expect((await sql<{ sentVia: string }>(`SELECT "sentVia" FROM "Application" WHERE id = '${draft.id}'`))[0].sentVia).toBe("EMAIL");
});
