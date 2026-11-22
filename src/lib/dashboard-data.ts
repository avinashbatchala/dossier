import "server-only";

import { dashboardFigures, type DashboardApplication, type DashboardFigures, type DashboardOptions } from "@/lib/dashboard";
import { latestContact } from "@/lib/application-flag";
import { prisma } from "@/lib/prisma";

/**
 * Every dashboard figure, from all applications, archived ones included
 * (E9-6), for a period (E9-8), with the follow-up threshold and time zone
 * for Needs you (E9-9, E28-4).
 */
export async function loadDashboard(options: DashboardOptions = {}, now = new Date()): Promise<DashboardFigures> {
  return dashboardFigures(await loadDashboardApplications(), now, options);
}

/** Every application as the dashboard reads it; agent drafts count once they're approved (#195). */
export async function loadDashboardApplications(): Promise<DashboardApplication[]> {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false },
    select: {
      id: true,
      title: true,
      company: true,
      role: true,
      status: true,
      furthestStage: true,
      archivedAt: true,
      deadline: true,
      sentAt: true,
      nextInterviewAt: true,
      contactedAt: true,
      offer: { select: { decideBy: true } },
      createdAt: true,
      updatedAt: true,
      events: { select: { at: true }, orderBy: { at: "desc" }, take: 1 },
      // A reply in or a follow-up out restarts "Quiet for" (E29-7).
      emails: { where: { dismissedAt: null }, select: { sentAt: true }, orderBy: { sentAt: "desc" }, take: 1 },
    },
  });
  return applications.map((application) => ({
      id: application.id,
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      status: application.status,
      furthestStage: application.furthestStage,
      archived: application.archivedAt !== null,
      deadline: application.deadline,
      lastStatusChange: application.events[0]?.at ?? null,
      sentAt: application.sentAt,
      nextInterviewAt: application.nextInterviewAt,
      lastContactAt: latestContact(application.emails[0]?.sentAt, application.contactedAt),
      decideBy: application.offer?.decideBy ?? null,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    }));
}
