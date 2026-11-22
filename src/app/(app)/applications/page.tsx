import type { Metadata } from "next";

import { laneNotes, listSummary, resolveListParams, sidebarStatuses, statusesShown, statusSummary } from "@/lib/applications-list";
import { loadApplicationRows } from "@/lib/applications-data";
import { calendarInUse } from "@/lib/google/availability";
import { waitingByApplication } from "@/lib/google/inbox-data";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { userTimeZone } from "@/lib/time-zone";

import { ApplicationsScreen } from "./applications-screen";

export const metadata: Metadata = { title: "Applications" };

/**
 * Every application, on a board or in a list (PRD §6.6), or one status's
 * (E29-1): its title, a line on what stands out, and the status tabs.
 */
export default async function ApplicationsPage({ searchParams }: PageProps<"/applications">) {
  const [settings, timeZone, replies, calendar] = await Promise.all([
    loadSettings(),
    userTimeZone(),
    waitingByApplication().catch(() => undefined),
    calendarInUse().catch(() => null),
  ]);
  // The URL wins; without it, the view and sort last used (LST-7), per status for the view (LB1).
  const params = resolveListParams(await searchParams, settings);

  const [all, archived] = await Promise.all([
    loadApplicationRows({ archived: params.archived, sort: params.sort }, { timeZone, quietDays: settings.quietDays, replies }),
    prisma.application.count({ where: { archivedAt: { not: null }, awaitingReview: false } }),
  ]);
  const q = params.q.toLocaleLowerCase();
  const found = q ? all.filter((row) => `${row.company} ${row.role}`.toLocaleLowerCase().includes(q)) : all;
  const current = all.filter((row) => !row.archived);
  const counts = new Map<(typeof current)[number]["status"], number>();
  for (const row of current) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);

  return (
    <ApplicationsScreen
      params={params}
      // The board keeps every lane, with the status's own picked out (E29-6); a list shows only that status.
      rows={params.view === "board" ? found : found.filter((row) => statusesShown(params).includes(row.status))}
      tabs={{ all: current.length, statuses: sidebarStatuses(counts) }}
      summary={params.status ? statusSummary(params.status, current) : listSummary(current.map((row) => row.status))}
      empty={current.length === 0 && all.length === 0 && archived === 0}
      archivedCount={archived}
      laneNotes={laneNotes(current)}
      calendar={calendar !== null}
    />
  );
}
