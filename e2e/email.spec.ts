import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The Email tab: writing the email an application is sent with, copying it,
// rewriting it with Undo, and changing it by hand and from the chat.
let url = "";
test.beforeAll(async () => {
  await resetData();
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await sql(`UPDATE "Application" SET "postingText" = "postingText" || $2 WHERE id = $1`, [
    ledgerly.id,
    "\n\nSend your application to John Doe, careers@example.com.",
  ]);
  url = `/applications/${ledgerly.id}?tab=email`;
});

test("writes the email, ready to copy, with the PDFs to attach", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(url);
  await page.getByRole("button", { name: "Write the email" }).click();

  const email = page.getByRole("article", { name: "Email" });
  await expect(email.getByRole("group", { name: "Recipient" })).toContainText("John Doe <careers@example.com>");
  await expect(email.getByRole("group", { name: "Subject" })).toContainText("Application: Senior Product Designer, Payments");
  await expect(email.getByRole("group", { name: "Message" })).toContainText(/^Dear John,\s+I'm applying/);
  await expect(email.getByRole("group", { name: "Message" })).toContainText(/Warm regards,\s+Jane Doe/);

  await page.getByRole("button", { name: "Copy the subject" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Application: Senior Product Designer, Payments");
  await page.getByRole("button", { name: "Copy message" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Dear John,\n\nI'm applying[^]*Warm regards,\nJane Doe$/);
  await expect(page.getByRole("link", { name: "Open in mail app" })).toHaveAttribute(
    "href",
    /^mailto:careers@example\.com\?subject=Application%3A%20Senior%20Product%20Designer%2C%20Payments&body=Dear%20John%2C%0D%0A/,
  );
  await expect(email.getByRole("link", { name: /^Download .* Resume\.pdf$/ })).toBeVisible();
  await expect(email.getByRole("link", { name: /^Download .* Cover letter\.pdf$/ })).toBeVisible();

  await page.reload();
  await expect(email.getByRole("group", { name: "Recipient" })).toContainText("John Doe <careers@example.com>");
});

test("rewrites the email, and Undo brings the first one back", async ({ page }) => {
  await page.goto(url);
  const message = page.getByRole("group", { name: "Message" });
  await expect(message).toContainText("I'm applying");
  await page.getByRole("button", { name: "Write it again" }).click();
  await expect(message).toContainText("I'd love to help");
  // The toast's Undo; the latest change above the composer has one too.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(message).toContainText("I'm applying");
});

test("edits the subject by hand", async ({ page }) => {
  await page.goto(url);
  const subject = page.getByRole("group", { name: "Subject" });
  await subject.hover();
  await subject.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("textbox", { name: "Edit Subject" }).fill("Senior Product Designer, Payments: Jane Doe");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(subject).toContainText("Senior Product Designer, Payments: Jane Doe");
});

test("changes the email from the chat, and puts it back with Undo", async ({ page }) => {
  await page.goto(url);
  const message = page.getByRole("group", { name: "Message" });
  await expect(message).toContainText("I've designed complex operational tools");
  await page.getByRole("textbox", { name: "Ask for a change" }).fill("Make it shorter");
  await page.getByRole("textbox", { name: "Ask for a change" }).press("Enter");

  const log = page.getByRole("log", { name: "Conversation" });
  await expect(log.getByText("Done. I made the email shorter.")).toBeVisible();
  await expect(message).not.toContainText("I've designed complex operational tools");
  await log.getByRole("button", { name: "Undo" }).click();
  await expect(message).toContainText("I've designed complex operational tools");
});
