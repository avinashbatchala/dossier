import { expect, test, type Page } from "@playwright/test";

import { answerUsagePing, fakePings, resetData, sql } from "./support";

// The usage ping is opt-in (#172): a production server asks once after
// sign-in and sends nothing before a yes. Here a yes reaches the fake
// receiver (DOSSIER_USAGE_PING_TEST_URL), never the project's.
test.beforeAll(resetData);
test.afterAll(() => answerUsagePing("off"));

const OLD_ID = "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c";
const question = (page: Page) => page.getByRole("dialog", { name: "Send a daily usage ping?" });
const setting = async (key: string) => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = $1`, [key]))[0]?.value ?? null;

/** An install that pinged before 1.8 and hasn't answered: it has an ID and no answer. */
async function upgradedInstall() {
  await answerUsagePing(null);
  await sql(`DELETE FROM "Setting" WHERE key IN ('usagePingId', 'usagePingDay')`);
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('usagePingId', $1, now())`, [OLD_ID]);
}

test("asks once, sends nothing before an answer, and treats closing it as a no", async ({ page }) => {
  await upgradedInstall();
  const before = (await fakePings()).length;
  await page.goto("/");
  const dialog = question(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  // Equal weight: the same look for both answers.
  const no = dialog.getByRole("button", { name: "Don't send" });
  const yes = dialog.getByRole("button", { name: "Send usage ping" });
  expect(await no.getAttribute("class")).toBe(await yes.getAttribute("class"));
  // Loading pages before an answer sends nothing.
  await page.goto("/applications");
  await expect(question(page)).toBeVisible();
  expect((await fakePings()).length).toBe(before);

  await page.keyboard.press("Escape");
  await expect(question(page)).toBeHidden();
  await expect.poll(() => setting("usagePingChoice")).toBe("off");
  expect(await setting("usagePingId")).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(question(page)).toHaveCount(0);
  expect((await fakePings()).length).toBe(before);
});

test("sends the ping after a yes, keeping the install's ID", async ({ page }) => {
  await upgradedInstall();
  await page.goto("/");
  await question(page).getByRole("button", { name: "Send usage ping" }).click();
  await expect(question(page)).toBeHidden();
  expect(await setting("usagePingChoice")).toBe("on");
  expect(await setting("usagePingChoiceText")).toBe("1");

  // The next page sends it, once.
  await page.goto("/applications");
  await expect.poll(async () => (await fakePings()).filter((ping) => ping.id === OLD_ID).length).toBe(1);
});

test("switches it off in Settings → About, forgetting the ID, and asks no more", async ({ page }) => {
  await answerUsagePing("on");
  await page.goto("/settings?section=about");
  const toggle = page.getByRole("switch", { name: "Send the daily usage ping" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAccessibleDescription("Off. Nothing is sent, and this install's ID is forgotten.");
  await expect.poll(() => setting("usagePingChoice")).toBe("off");
  expect(await setting("usagePingId")).toBeNull();
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(question(page)).toHaveCount(0);
});

test("a no in the dialog is stored like closing it", async ({ page }) => {
  await upgradedInstall();
  await page.goto("/settings?section=about");
  await question(page).getByRole("button", { name: "Don't send" }).click();
  await expect(question(page)).toBeHidden();
  await expect.poll(() => setting("usagePingChoice")).toBe("off");
  await page.reload();
  await expect(page.getByRole("switch", { name: "Send the daily usage ping" })).toHaveAccessibleDescription(
    "Off. Nothing is sent, and this install's ID is forgotten.",
  );
});
