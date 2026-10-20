"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { approveCandidate } from "@/lib/agent/draft";
import { prisma } from "@/lib/prisma";

import { statusInfo } from "./status";
import { applyStatusChange, undoStatusChange } from "./status-changes";

const NOT_FOUND = "That application no longer exists.";

// Status figures show on the dashboard, the applications list and each
// application, so every change refreshes all pages (DSH-6).
function refreshEverything() {
  revalidatePath("/", "layout");
}

/**
 * Moves an application to another status. Every status change in the app goes
 * through here: the application page, the board and the table. Returns the
 * event id for Undo, or null when the status didn't change.
 */
export const setStatus = action(
  z.object({ id: z.string().min(1), to: z.enum(ApplicationStatus) }),
  async ({ id, to }, { toast }) => {
    // An agent draft still waiting for review is approved by moving it on: it's being pursued (#195).
    if (to !== ApplicationStatus.DRAFT) {
      const pending = await prisma.agentCandidate.findFirst({ where: { applicationId: id, application: { awaitingReview: true } }, select: { id: true } });
      if (pending) await approveCandidate(pending.id);
    }
    const result = await applyStatusChange(prisma, id, to);
    if (result.outcome === "not-found") throw new ActionError(NOT_FOUND);
    if (result.outcome === "unchanged") return { eventId: null };

    refreshEverything();
    toast(statusInfo(to).toast);
    return { eventId: result.event.id };
  },
);

/** Undoes a status change from its toast (decision in #26). */
export const undoStatus = action(
  z.object({ eventId: z.string().min(1) }),
  async ({ eventId }, { toast }) => {
    const result = await undoStatusChange(prisma, eventId);
    if (result.outcome === "not-found") throw new ActionError(NOT_FOUND);
    if (result.outcome === "superseded") {
      throw new ActionError("The status has changed again since, so this change can't be undone.");
    }

    refreshEverything();
    toast(`Moved back to ${statusInfo(result.status).label.toLowerCase()}.`);
    return { status: result.status };
  },
);
