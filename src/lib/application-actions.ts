"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { cancelApplicationJobs } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";

// Archiving and deleting an application (E9-5, LST-8), from its page, a
// card or a table row.

const GONE = "That application no longer exists.";

// The list, the dashboard and the application all show it.
const refreshEverything = () => revalidatePath("/", "layout");

/**
 * Archives an application, or brings it back. Archived ones leave the board
 * but still count on the dashboard. Tidying up isn't news, so "Updated"
 * stays as it was.
 */
export const setArchived = action(z.object({ id: z.string().min(1), archived: z.boolean() }), async ({ id, archived }) => {
  const current = await prisma.application.findUnique({ where: { id }, select: { updatedAt: true } });
  if (!current) throw new ActionError(GONE);
  await prisma.application.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null, updatedAt: current.updatedAt },
  });
  refreshEverything();
  return null;
});

/**
 * Deletes an application with its documents and their versions, chat,
 * notes, status history and background jobs, whose inputs and results hold
 * the posting and the documents too (the database cascades).
 */
export const deleteApplication = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  await cancelApplicationJobs(id);
  const { count } = await prisma.application.deleteMany({ where: { id } });
  if (count === 0) throw new ActionError(GONE);
  refreshEverything();
  return null;
});
