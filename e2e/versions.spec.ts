import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { fillPosting, resetData } from "./support";

// Document history (E8-10, E30-11): the first draft and each AI change are
// versions, in one feed across the documents; going back to one makes a new one.
test.beforeAll(resetData);

test("restores the first draft after a change from the chat", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await fillPosting(page, "Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma\n- 5+ years of product design");
  await page.getByRole("button", { name: "Read the posting" }).click();
  await expect(page.getByRole("heading", { name: "What I read from the posting" })).toBeVisible();
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  const summary = page.locator('[data-unit="summary"]');
  // The part's text, without its toolbar's labels.
  const draft = (await summary.textContent())!.replace(/EditRegenerateAsk AILeave out$/, "");
  await page.getByRole("textbox", { name: "Ask for a change" }).fill("Make the summary shorter");
  await page.getByRole("textbox", { name: "Ask for a change" }).press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Done. I made the summary shorter.")).toBeVisible();
  await expect(summary).not.toContainText(draft);

  // One history across the documents, above the composer (E30-11).
  await page.getByRole("button", { name: /^History · v\d+$/ }).first().click();
  const changes = page.getByRole("list", { name: "Changes" });
  await expect(changes.getByRole("listitem").first()).toContainText("Done. I made the summary shorter.");
  const firstDraft = changes.getByRole("listitem").filter({ hasText: "Resume v1" });
  await expect(firstDraft).toContainText("Tailoring");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await firstDraft.getByRole("button", { name: /^Go back to this/ }).click();
  await expect(page.getByText("Went back. What you had is in the history too.")).toBeVisible();
  await expect(summary).toContainText(draft);
  await page.reload();
  await expect(summary).toContainText(draft);

  await page.getByRole("button", { name: /^History · v\d+$/ }).first().click();
  await expect(changes.getByRole("listitem").first()).toContainText("Went back to an earlier version");
});
