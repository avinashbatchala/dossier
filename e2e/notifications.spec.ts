import { createHmac } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { FAKE_JOBS_PORT, fakeWebhookPosts, resetData, sql } from "./support";

// Settings → Notifications (E26, #416–#418): a webhook channel, its signed
// test message, the grid and the delivery log.

test.beforeAll(resetData);
test.afterAll(async () => {
  await sql(`DELETE FROM "NotificationChannel"`);
});

test("adds a webhook, sends a signed test, and switches events in the grid", async ({ page, context }) => {
  await page.goto("/settings?section=notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(page.getByText("No channels yet. Add one to start getting messages.")).toBeVisible();

  await page.getByRole("button", { name: "Add channel" }).click();
  const form = page.getByRole("form", { name: "New channel" });
  await form.getByRole("radio", { name: "Webhook" }).click();
  await form.getByLabel("Name").fill("n8n");
  await form.getByLabel("Address").fill(`http://localhost:${FAKE_JOBS_PORT}/webhook-sink`);
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id)).toEqual([]);
  await form.getByRole("button", { name: "Add channel" }).click();
  await expect(page.getByRole("heading", { name: "n8n" })).toBeVisible();

  // A test goes out at once, signed with the secret Dossier made, which can be copied.
  await page.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent: check that it arrived." })).toBeVisible();
  const [post] = (await fakeWebhookPosts()).slice(-1);
  expect(post.event).toBe("test");
  expect(JSON.parse(post.body)).toMatchObject({ event: "test", title: "A test from Dossier", text: "If you can read this, notifications to “n8n” work." });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy secret" }).click();
  await expect(page.getByText("Copied the signing secret.")).toBeVisible();
  const secret = await page.evaluate(() => navigator.clipboard.readText());
  const seconds = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(post.signature ?? "");
  expect(seconds?.[2]).toBe(createHmac("sha256", secret).update(`${seconds?.[1]}.${post.body}`).digest("hex"));

  // The log says so; the grid starts at the defaults and keeps a switch.
  await expect(page.getByRole("row", { name: /Send a test n8n Sent/ })).toBeVisible();
  const grid = page.getByRole("table").first();
  await expect(grid.getByRole("switch", { name: "Agent run finished, to n8n" })).toBeChecked();
  await grid.getByRole("switch", { name: "A draft is ready, to n8n" }).click();
  await expect(grid.getByRole("switch", { name: "A draft is ready, to n8n" })).toBeChecked();
  await expect.poll(async () => (await sql<{ events: Record<string, boolean> }>(`SELECT events FROM "NotificationChannel"`))[0]?.events).toEqual({ "draft.ready": true });
  await page.reload();
  await expect(page.getByRole("table").first().getByRole("switch", { name: "A draft is ready, to n8n" })).toBeChecked();
});
