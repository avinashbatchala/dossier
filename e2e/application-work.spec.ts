import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The application screen's work started on a click (E30): Ask, Prepare's
// checklist for an interview, the offer and its answers, and a follow-up.
// At this width the Fit column is a rail that opens over the document.
let id = "";
test.beforeEach(async () => {
  await resetData();
  [{ id }] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

test("asks a question, which changes nothing (E30-10)", async ({ page }) => {
  await page.goto(`/applications/${id}`);
  await page.waitForLoadState("networkidle");
  const composer = page.getByRole("region", { name: "Composer" });
  await composer.getByRole("radio", { name: "Ask" }).click();
  await page.getByRole("textbox", { name: "Ask a question" }).fill("What matters most to them?");
  await page.getByRole("textbox", { name: "Ask a question" }).press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" })).toContainText("They care most about design systems and payments.");
});

test("writes Getting ready for an interview on Prepare, and keeps its ticks (E30-6)", async ({ page }) => {
  await sql(`UPDATE "Application" SET status = 'INTERVIEW', "nextInterviewAt" = $2 WHERE id = $1`, [id, new Date(Date.now() + 3 * 86_400_000).toISOString()]);
  await page.goto(`/applications/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Prepare" }).first().click();
  const column = page.getByRole("dialog", { name: "How you fit" });
  const item = column.getByRole("checkbox", { name: "Prepare a payments story for the fintech gap" });
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.check();
  await expect.poll(async () => (await sql<{ prep: { done: boolean }[] }>(`SELECT prep FROM "Interview" WHERE "applicationId" = $1`, [id]))[0]?.prep[1]?.done).toBe(true);

  await page.reload();
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  await expect(page.getByRole("dialog", { name: "How you fit" }).getByRole("checkbox", { name: "Prepare a payments story for the fintech gap" })).toBeChecked();
});

test("keeps the offer, and drafts an acceptance to copy (E30-7)", async ({ page }) => {
  await sql(`UPDATE "Application" SET status = 'OFFER', "emailThreadId" = NULL WHERE id = $1`, [id]);
  await page.goto(`/applications/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Show how you fit/ }).click();
  const column = page.getByRole("dialog", { name: "How you fit" });
  await column.getByLabel("Salary").fill("€82,500");
  await column.getByLabel("Decide by").fill("2030-12-11");
  await column.getByRole("button", { name: "Save" }).click();
  await expect(column.getByText("€82,500")).toBeVisible();

  await column.getByRole("button", { name: "Draft an acceptance" }).click();
  const draft = page.getByRole("region", { name: "Your acceptance" });
  await expect(draft.getByRole("textbox", { name: "Message" })).toHaveValue(/happy to accept/, { timeout: 20_000 });
  await expect(page.getByRole("tab", { name: /^Email/ })).toHaveAttribute("aria-selected", "true");
});

test("drafts a follow-up for a quiet application, and I sent it starts Quiet for again (E30-8)", async ({ page }) => {
  await sql(`UPDATE "Application" SET status = 'SENT', "sentAt" = $2, "emailThreadId" = NULL WHERE id = $1`, [id, daysAgo(30)]);
  await sql(`DELETE FROM "StatusEvent" WHERE "applicationId" = $1`, [id]);
  await page.goto(`/applications/${id}`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Draft a follow-up" }).click();
  const draft = page.getByRole("region", { name: "A follow-up" });
  await expect(draft.getByRole("textbox", { name: "Subject" })).toHaveValue("Following up on my application", { timeout: 20_000 });
  await draft.getByRole("button", { name: "I sent it" }).click();
  await expect(page.getByText("Noted. “Quiet for” starts again from today.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft a follow-up" })).toHaveCount(0);
  expect((await sql<{ contactedAt: Date | null }>(`SELECT "contactedAt" FROM "Application" WHERE id = $1`, [id]))[0].contactedAt).not.toBeNull();
});
