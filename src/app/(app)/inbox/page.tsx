import type { Metadata } from "next";

import { isAiConfigured } from "@/lib/ai/config";
import { googleConnection } from "@/lib/google/account";
import { loadInbox } from "@/lib/google/inbox-data";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { userTimeZone } from "@/lib/time-zone";

import { InboxScreen } from "./inbox-screen";

export const metadata: Metadata = { title: "Inbox" };

/**
 * Employers' replies from Gmail (E15-3): the ones waiting for an answer,
 * mail that couldn't be linked to an application, and recent updates.
 */
export default async function InboxPage() {
  const [inbox, connection, settings, aiReady, timeZone, applications] = await Promise.all([
    loadInbox(),
    googleConnection(),
    loadSettings(),
    isAiConfigured(),
    userTimeZone(),
    prisma.application.findMany({
      where: { archivedAt: null, awaitingReview: false },
      orderBy: { updatedAt: "desc" },
      select: { id: true, company: true, role: true, title: true },
    }),
  ]);
  return (
    <InboxScreen
      inbox={inbox}
      connected={connection.status === "connected" && connection.canRead && settings.gmailRead}
      configured={connection.status !== "not-configured"}
      lastSync={connection.status === "connected" ? connection.lastSyncAt : null}
      problem={connection.status === "connected" ? connection.syncProblem : null}
      aiReady={aiReady}
      timeZone={timeZone}
      applications={applications.map((application) => ({
        id: application.id,
        label: [application.company, application.role || application.title].filter(Boolean).join(", ") || "Untitled application",
      }))}
    />
  );
}
