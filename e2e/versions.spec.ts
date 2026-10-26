import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetData } from "./support";

// Document history (E8-10): the first draft and each AI change are versions;
// an earlier one can be looked at in place and restored.
test.beforeAll(resetData);

test("restores the first draft after a change from the chat", async ({ page }) => {
  await page.goto("/new?fresh=1");
  await page.getByLabel("Job posting").fill("Ledgerly: Senior Product Designer, Payments\n- Strong prototyping skills in Figma\n- 5+ years of product design");
  await page.getByRole("button", { name: "Read the posting →" }).click();
  await expect(page.getByRole("heading", { name: "How you match" })).toBeVisible();
  await page.getByRole("button", { name: "Create application →" }).click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });

  const summary = page.locator('[data-unit="summary"]');
  // The part's text, without its toolbar's labels.
  const draft = (await summary.textContent())!.replace(/EditRegenerateAsk AILeave out$/, "");
  await page.getByRole("textbox", { name: "Ask for a change" }).fill("Make the summary shorter");
  await page.getByRole("textbox", { name: "Ask for a change" }).press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Done. I made the summary shorter.")).toBeVisible();
  await expect(summary).not.toContainText(draft);

  await page.getByRole("button", { name: "History" }).first().click();
  const history = page.getByRole("dialog", { name: "History of the resume" });
  const versions = history.getByRole("list", { name: "Versions" });
  await expect(versions.getByRole("listitem")).toHaveCount(2);
  await expect(versions.getByRole("listitem").first()).toContainText("Changed from the chat: “Make the summary shorter”");
  await expect(versions.getByRole("listitem").last()).toContainText("Written by the AI");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);

  await versions.getByRole("listitem").last().getByRole("button", { name: /^Look at the version from/ }).click();
  await expect(page.getByRole("note").filter({ hasText: "You're looking at the version from" })).toContainText("Written by the AI.");
  await expect(summary).toHaveText(draft);
  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText(/^Restored the resume as it was then\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore this version" })).toHaveCount(0);
  await page.reload();
  await expect(summary).toContainText(draft);

  await page.getByRole("button", { name: "History" }).first().click();
  await expect(versions.getByRole("listitem").first()).toContainText("Brought back the version from");
});
