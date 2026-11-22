import "server-only";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { dayOf } from "@/lib/calendar-view";
import { quietApplications } from "@/lib/dashboard";
import { loadDashboardApplications } from "@/lib/dashboard-data";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { availableUpdate, checkIfNewDay } from "@/lib/update-check";

import { emit } from "./notify";

// The daily notification check (E26-7, #422): once a day at 18:00 in the
// user's time zone, like the agent's schedule, the events that come with a
// date: an interview tomorrow, follow-ups due ("No news for N days", as the
// dashboard counts them) and a new version of Dossier, which the server
// checks for itself while "Check for updates daily" is on. A server that
// starts after 18:00 runs it then; one that's off all evening skips the day.

const DAILY_HOUR = 18;
const TICK_MS = 10 * 60_000;
const FIRST_TICK_MS = 60_000;

/** The hour in `timeZone`, 0 to 23. */
const hourIn = (moment: Date, timeZone: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(moment));

/** "2026-11-17" for "2026-11-16". */
function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Runs the day's check once at or after 18:00 local time: "waiting" before
 * it, "done" once it ran today. The day is saved before the work, so a
 * failure doesn't send the same messages twice.
 */
export async function runDailyCheck(now = new Date(), { checkUpdate = () => checkIfNewDay({ now }) }: { checkUpdate?: () => Promise<unknown> } = {}): Promise<"waiting" | "done" | "ran"> {
  const timeZone = await lastKnownTimeZone();
  if (hourIn(now, timeZone) < DAILY_HOUR) return "waiting";
  const today = dayOf(now, timeZone);
  const settings = await loadSettings();
  if (settings.notificationsDay === today) return "done";
  await saveSettings({ notificationsDay: today });

  const applications = (await loadDashboardApplications()).filter((application) => !application.archived);

  // An interview tomorrow: one message each, with its time in the user's zone.
  const tomorrow = nextDay(today);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const application of applications) {
    const at = application.nextInterviewAt;
    if (application.status !== ApplicationStatus.INTERVIEW || !at || dayOf(at, timeZone) !== tomorrow) continue;
    await emit("interview.tomorrow", { applicationId: application.id, title: application.role, company: application.company, time: time.format(at) }, now);
  }

  // Follow-ups due, in one message.
  const quiet = quietApplications(applications, now, settings.quietDays);
  if (quiet.length > 0) {
    await emit("followup.due", { applications: quiet.map(({ application, days }) => ({ id: application.id, title: application.role, company: application.company, days })) }, now);
  }

  // A new version, once per version, while the daily update check is on.
  if (settings.updateCheck) {
    await checkUpdate();
    const latest = await loadSettings();
    const update = availableUpdate(latest);
    if (update && latest.notifiedVersion !== update.version) {
      await saveSettings({ notifiedVersion: update.version });
      await emit("version.new", { version: update.version, url: update.url }, now);
    }
  }
  return "ran";
}

const globalForDaily = globalThis as unknown as { notificationDailyTimer?: ReturnType<typeof setTimeout> };

/** Starts the check's timer, once per process: soon after the start, then every 10 minutes. */
export function startDailyNotificationCheck(): void {
  if (globalForDaily.notificationDailyTimer) return;
  const tick = (delay: number) => {
    globalForDaily.notificationDailyTimer = setTimeout(() => {
      void runDailyCheck()
        .catch((error: unknown) => logServerError("daily notifications", error))
        .finally(() => tick(TICK_MS));
    }, delay);
    globalForDaily.notificationDailyTimer.unref?.();
  };
  tick(FIRST_TICK_MS);
}
