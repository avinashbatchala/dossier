import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { connectFakeGoogle, fakeGoogle, forgetGoogle, inFakeCalendar, resetData, sql } from "./support";

// The Calendar screen and interviews kept in step with Google Calendar
// (E15-6), against the fake Google (e2e/fake-google.mts).

test.beforeAll(resetData);
test.afterAll(forgetGoogle);

/** No serious axe findings, in the light scheme and then the dark one. */
async function expectAccessible(page: Page) {
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((chosen) => (document.documentElement.dataset.theme = chosen), scheme);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => `${scheme}: ${violation.id}`)).toEqual([]);
  }
  await page.evaluate(() => delete document.documentElement.dataset.theme);
}

/** "Tuesday 20 October", as the calendar labels a day. */
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T00:00:00Z`));

test("shows interviews and Google's events, and keeps interviews in step both ways", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const [northstar] = await sql<{ id: string; nextInterviewAt: Date }>(`SELECT id, "nextInterviewAt" FROM "Application" WHERE company = 'Northstar Health'`);
  const interview = () => sql<{ nextInterviewAt: Date | null; interviewEventId: string | null }>(`SELECT "nextInterviewAt", "interviewEventId" FROM "Application" WHERE id = $1`, [northstar.id]).then(([row]) => row);
  // The day of the demo's interview, in the browser's zone, which the app uses too.
  await page.goto("/");
  const day = await page.evaluate((iso) => new Date(iso).toLocaleDateString("en-CA"), northstar.nextInterviewAt.toISOString());
  const week = `/calendar?view=week&date=${day}`;
  const column = page.getByRole("region", { name: dayLabel(day) });

  // Without Google: the interview, linked to its application, and how to see the rest.
  await page.goto(week);
  await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
  await expect(column.getByRole("link", { name: /Interview · Lead Product Designer · Northstar Health/ })).toHaveAttribute("href", `/applications/${northstar.id}`);
  await expect(page.getByText(/Connect Google Calendar in Settings → Google/)).toBeVisible();
  await page.getByRole("radio", { name: "Month" }).click();
  await expect(page).toHaveURL(/view=month/);
  await expect(column.getByRole("link", { name: /Northstar Health/ })).toBeVisible();
  await expectAccessible(page);

  // Connected, with an event of its own in Google that day.
  await connectFakeGoogle(page);
  const dentist = await inFakeCalendar("POST", undefined, { summary: "Dentist", start: { dateTime: `${day}T11:00:00Z` }, end: { dateTime: `${day}T11:30:00Z` } });

  // Setting the interview's time in Dossier adds it to Google.
  await page.goto(`/applications/${northstar.id}`);
  await page.getByRole("button", { name: /^Next interview: .*\. Change$/ }).click();
  await page.getByRole("dialog").getByLabel("Date and time").fill(`${day}T14:00`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Interview date saved, in your calendar too.")).toBeVisible();
  await expect.poll(async () => (await interview()).interviewEventId).not.toBeNull();
  const added = (await fakeGoogle()).events.find((event) => event.extendedProperties?.private?.dossierApplication === northstar.id)!;
  expect(added.summary).toBe("Interview · Lead Product Designer · Northstar Health");
  expect(new Date(added.start.dateTime!).getTime()).toBe((await interview()).nextInterviewAt!.getTime());

  // Both on the calendar: the interview opens its application, the dentist Google Calendar.
  await page.goto(week);
  await expect(column.getByRole("link", { name: /Dentist/ })).toHaveAttribute("href", dentist.htmlLink);
  await expect(column.getByRole("link", { name: /^14:00 Interview · Lead Product Designer · Northstar Health$/ })).toHaveAttribute("href", `/applications/${northstar.id}`);
  await expectAccessible(page);
  await page.goto(`/calendar?view=month&date=${day}`);
  await expect(column.getByRole("link", { name: /Dentist/ })).toBeVisible();
  await expectAccessible(page);

  // Moved in Google: Dossier follows when the calendar opens.
  await inFakeCalendar("PATCH", added.id, { start: { dateTime: `${day}T15:00:00Z` }, end: { dateTime: `${day}T15:45:00Z` } });
  await page.goto(week);
  await expect.poll(async () => (await interview()).nextInterviewAt?.toISOString()).toBe(new Date(`${day}T15:00:00Z`).toISOString());

  // Removing the date in Dossier deletes the event.
  await page.goto(`/applications/${northstar.id}`);
  await page.getByRole("button", { name: /^Next interview: .*\. Change$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Interview date removed, from your calendar too.")).toBeVisible();
  await expect.poll(async () => (await fakeGoogle()).events.some((event) => event.id === added.id)).toBe(false);

  // Deleted in Google: an interview set again, then deleted there, loses its date.
  await page.getByRole("button", { name: "Add the interview date" }).click();
  await page.getByRole("dialog").getByLabel("Date and time").fill(`${day}T09:00`);
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await interview()).interviewEventId).not.toBeNull();
  await inFakeCalendar("DELETE", (await interview()).interviewEventId!);
  await page.reload();
  await expect(page.getByRole("button", { name: "Add the interview date" })).toBeVisible();
  expect((await interview()).nextInterviewAt).toBeNull();
});
