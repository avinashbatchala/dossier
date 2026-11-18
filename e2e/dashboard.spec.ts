import { expect, test } from "@playwright/test";

import { resetData, sql } from "./support";

// The dashboard's numbers (E9-6, E9-7) agree with the data, and follow a change.
test.beforeAll(resetData);

async function expected() {
  const [row] = await sql<{ sent: number; heard: number; interview: number }>(`
    SELECT count(*) FILTER (WHERE "furthestStage" IS NOT NULL)::int AS sent,
           count(*) FILTER (WHERE "furthestStage" IN ('SCREENING', 'INTERVIEW', 'OFFER', 'ACCEPTED'))::int AS heard,
           count(*) FILTER (WHERE "furthestStage" IN ('INTERVIEW', 'OFFER', 'ACCEPTED'))::int AS interview
    FROM "Application"`);
  return row;
}

test("shows the funnel as the data has it", async ({ page }) => {
  const { sent, heard, interview } = await expected();
  await page.goto("/");
  const funnel = page.getByRole("region", { name: "Your funnel" });
  const figure = (label: string) => funnel.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
  await expect(figure("sent")).toHaveText(String(sent));
  await expect(figure("heard back")).toHaveText(`${Math.round((heard / sent) * 100)}%`);
  await expect(figure("reached interview")).toHaveText(String(interview));
  // The header counts all time (E28-1).
  await expect(page.getByText(`${sent} sent, ${heard} heard back.`)).toBeVisible();

  // One more heard back.
  await page.goto("/applications?view=table");
  await page.getByLabel("Status of Product Designer, Mobile, Kestrel Maps").selectOption("SCREENING");
  await expect(page.getByText("In screening. They're taking a look.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(`${sent} sent, ${heard + 1} heard back.`)).toBeVisible();
});

test("the time filter scopes the left zone's figures and is remembered (E9-8, E28-1)", async ({ page }) => {
  const [recent] = await sql<{ started: number; sent: number }>(`
    SELECT count(*)::int AS started, count(*) FILTER (WHERE "furthestStage" IS NOT NULL)::int AS sent
    FROM "Application" WHERE "createdAt" >= now() - interval '30 days'`);
  const { sent, heard } = await expected();
  await page.goto("/");
  const search = page.getByRole("region", { name: "Your search so far" });
  await search.getByRole("radio", { name: "Last 30 days" }).click();
  await expect(page).toHaveURL(/\?period=30d$/);
  // The header isn't scoped.
  await expect(page.getByText(`${sent} sent, ${heard} heard back.`)).toBeVisible();
  const funnel = page.getByRole("region", { name: "Your funnel" });
  await expect(funnel.locator("dt", { hasText: "sent" }).locator("xpath=following-sibling::dd")).toHaveText(String(recent.sent));
  await expect(page.getByRole("region", { name: "Week by week" })).toContainText(`You started ${recent.started} applications`);

  // The next visit opens on the same period.
  await page.goto("/");
  await expect(page.getByRole("radio", { name: "Last 30 days" })).toBeChecked();
  await page.getByRole("radio", { name: "All time" }).click();
  await expect(page).toHaveURL(/\?period=all$/);
  await expect(funnel.locator("dt", { hasText: "sent" }).locator("xpath=following-sibling::dd")).toHaveText(String(sent));
});

test("interview dates show in Needs you, and moving to Interview asks for one (E9-9, E28-4)", async ({ page }) => {
  // The demo's interview is tomorrow.
  await page.goto("/");
  const needs = page.getByRole("region", { name: "Needs you" });
  const northstar = needs.getByRole("listitem").filter({ hasText: "Northstar Health" });
  await expect(northstar).toContainText(/Interview\. · tomorrow, \d\d:\d\d/);
  await expect(northstar.getByText(/^tomorrow,/)).toHaveClass(/text-warning/);
  await expect(northstar.getByRole("link", { name: /^Prepare/ })).toBeVisible();

  // Tidewater moves to Interview, with a date four days out.
  const [tidewater] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Tidewater Energy'`);
  await page.goto(`/applications/${tidewater.id}`);
  await page.getByRole("button", { name: "Status: Screening" }).click();
  await page.getByRole("menuitemradio", { name: /Interview/ }).click();
  const dialog = page.getByRole("dialog", { name: "When's the interview?" });
  await expect(dialog.getByLabel("Date and time")).toBeFocused();
  const later = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 4);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T10:30`;
  });
  await dialog.getByLabel("Date and time").fill(later);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Interview date saved. It'll show on your dashboard.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next interview: .*, 10:30\. Change$/ })).toBeVisible();

  await page.goto("/");
  await expect(needs.getByRole("listitem").filter({ hasText: "Tidewater Energy" })).toContainText(/Interview\. · \w{3} \d{1,2} \w{3}, 10:30/);
});

test("the follow-up threshold is a setting (E9-9)", async ({ page }) => {
  await page.goto("/");
  const needs = page.getByRole("region", { name: "Needs you" });
  const threshold = needs.getByLabel("Suggest a follow-up after");
  await expect(threshold).toHaveValue("7");
  // Every row, Show all included.
  if (await needs.getByRole("button", { name: /^Show all/ }).isVisible()) await needs.getByRole("button", { name: /^Show all/ }).click();
  const nudges = needs.getByRole("listitem").filter({ hasText: "quiet for" });
  const before = await nudges.count();

  await threshold.selectOption("3");
  await expect.poll(() => nudges.count()).toBeGreaterThan(before);
  await page.reload();
  await expect(needs.getByLabel("Suggest a follow-up after")).toHaveValue("3");
});

test("today's note is written after the page loads, and hides until tomorrow (E28-6)", async ({ page }) => {
  await page.goto("/");
  const note = page.getByRole("region", { name: "Today's note" });
  await expect(note).toContainText("Keep going, one kind step at a time.");
  // Written once: the next visit shows the same note without asking again.
  await page.reload();
  await expect(note).toContainText("Keep going, one kind step at a time.");
  await note.getByRole("button", { name: "Hide for today" }).click();
  await expect(note).toHaveCount(0);
  // It hides at once and saves after: reload only once it's saved.
  await expect.poll(async () => (await sql<{ value: string }>(`SELECT value FROM "Setting" WHERE key = 'dailyNote'`))[0]?.value).toContain('"hidden":true');
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(note).toHaveCount(0);
});
