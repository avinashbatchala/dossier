import type { Metadata } from "next";
import { Suspense } from "react";

import { periodFromParam } from "@/lib/dashboard";
import { waitingByApplication } from "@/lib/google/inbox-data";
import { loadDashboard } from "@/lib/dashboard-data";
import { dayPeriod, hourIn } from "@/lib/greeting";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { userTimeZone } from "@/lib/time-zone";

import { Dashboard } from "./dashboard";
import { CalendarSkeleton, DashboardCalendar } from "./dashboard-calendar";

export const metadata: Metadata = { title: "Dashboard" };

/**
 * Where the search stands (PRD §6.7). Read fresh on every visit, so a status
 * change anywhere shows at once (DSH-6). `?period=` picks the time filter,
 * else the one last used (E9-8). Interview times show in the browser's time
 * zone (E9-9). `?date=` picks the calendar's month (E15-6), which streams in
 * after the rest, as it waits on Google.
 */
export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const [{ period: param, date }, settings, timeZone] = await Promise.all([searchParams, loadSettings(), userTimeZone()]);
  const now = new Date();
  const range = periodFromParam(param) ?? settings.dashboardPeriod;
  const replies = await waitingByApplication().catch(() => undefined);
  const [figures, name] = await Promise.all([
    loadDashboard({ period: range, quietDays: settings.quietDays, timeZone, replies }),
    loadProfileName(),
  ]);
  return (
    <Dashboard
      figures={figures}
      firstName={name.trim().split(/\s+/)[0] ?? ""}
      period={dayPeriod(hourIn(timeZone))}
      range={range}
      quietDays={settings.quietDays}
      empty={figures.total === 0}
      calendar={
        <Suspense fallback={<CalendarSkeleton />}>
          <DashboardCalendar date={date} now={now} />
        </Suspense>
      }
    />
  );
}
