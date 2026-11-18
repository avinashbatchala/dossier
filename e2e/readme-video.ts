import { expect, test, type Page } from "@playwright/test";

import { resetData } from "./support";

// The README's recording (see playwright.readme.config.ts): a run through the
// app at 1280×800, saved as test-results/readme/demo.webm. Convert it to
// .github/images/demo.gif (ffmpeg or gifski) and check the README's caption.
test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, video: { mode: "on", size: { width: 1280, height: 800 } } });

test.beforeAll(resetData);

const POSTING = `Ledgerly: Senior Product Designer, Payments
Amsterdam (hybrid, 3 days in office) · €75,000–€90,000

What we're looking for
- 5+ years of product design
- You've built or maintained a design system
- Strong prototyping skills in Figma
- Experience with Kubernetes
- Dutch is a plus`;

const column = (page: Page, name: string) =>
  page.locator("section", { has: page.getByRole("heading", { name: new RegExp(`^${name}`) }) });

/** A moment for the viewer to take the screen in. */
const linger = (page: Page, ms = 1500) => page.waitForTimeout(ms);

test("a run through the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /^Good/ })).toBeVisible();
  await linger(page, 2000);

  // The board: a card from Sent to Screening.
  await page.getByRole("link", { name: "Applications", exact: true }).click();
  await expect(page.getByText("Kestrel Maps")).toBeVisible();
  await linger(page);
  const card = column(page, "Sent").locator("li", { hasText: "Kestrel Maps" });
  const from = (await card.boundingBox())!;
  const to = (await column(page, "Screening").boundingBox())!;
  await page.mouse.move(from.x + 60, from.y + 30);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 6 });
  await page.mouse.move(to.x + 120, to.y + 200, { steps: 30 });
  await page.mouse.up();
  await expect(column(page, "Screening")).toContainText("Kestrel Maps");
  await linger(page);

  // A new application from a pasted posting.
  await page.goto("/new?fresh=1");
  await linger(page, 800);
  await page.getByLabel("Job posting").fill(POSTING);
  await linger(page, 800);
  await page.getByRole("button", { name: "Read the posting" }).click();
  const match = page.getByRole("heading", { name: "What I read from the posting" });
  await expect(match).toBeVisible();
  await linger(page);
  await match.evaluate((heading) => {
    heading.scrollIntoView({ block: "start", behavior: "smooth" });
    window.scrollBy({ top: -96, behavior: "smooth" });
  });
  await linger(page, 2000);
  await page.getByRole("button", { name: "Write resume and letter" }).first().click();
  await page.waitForURL(/\/applications\/c/, { timeout: 30_000 });
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await linger(page, 2000);

  // Refining the tailored resume from the chat.
  const ask = page.getByRole("textbox", { name: "Ask for a change" });
  await ask.pressSequentially("Make the summary shorter", { delay: 40 });
  await linger(page, 500);
  await ask.press("Enter");
  await expect(page.getByRole("log", { name: "Conversation" }).getByText("Done. I made the summary shorter.")).toBeVisible();
  await linger(page, 2500);

  // The cover letter.
  await page.getByRole("tab", { name: "Cover letter" }).click();
  await expect(page.locator('[data-unit="greeting"]')).toBeVisible();
  await linger(page, 2500);

  // Switching the resume's theme.
  await page.goto("/resume");
  await expect(page.getByRole("button", { name: "Editorial theme, in use" })).toBeVisible();
  await linger(page);
  for (const theme of ["Classic", "Modern", "Technical"]) {
    await page.getByRole("button", { name: `${theme} theme` }).click();
    await expect(page.getByRole("button", { name: `${theme} theme, in use` })).toBeVisible();
    await linger(page, 1500);
  }

  const video = page.video();
  await page.close();
  await video?.saveAs("test-results/readme/demo.webm");
});
