import "server-only";

import { dashboardFigures, type DashboardFigures, type DashboardOptions } from "@/lib/dashboard";
import { prisma } from "@/lib/prisma";

/**
 * Every dashboard figure, from all applications, archived ones included
 * (E9-6), for a period (E9-8), with the follow-up threshold and time zone
 * for "Worth a look" (E9-9).
 */
export async function loadDashboard(options: DashboardOptions = {}, now = new Date()): Promise<DashboardFigures> {
  // Agent drafts count once they're approved (#195).
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
      createdAt: true,
      updatedAt: true,
      events: { select: { at: true }, orderBy: { at: "desc" }, take: 1 },
    },
  });
  return dashboardFigures(
    applications.map((application) => ({
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
      createdAt: application.createdAt,
      updatedAt: application.updatedAt,
    })),
    now,
    options,
  );
}
