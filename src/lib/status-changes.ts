import "server-only";

import type { PrismaClient, StatusEvent } from "@/generated/prisma/client";
import type { ApplicationStatus, SentVia } from "@/generated/prisma/enums";

import { frozenDataForSend, unfrozenData } from "./frozen-copy";
import { advance, undoChange } from "./status";

// Database side of the status model: every status change is written here, in
// a transaction, together with its StatusEvent.

export type StatusChangeResult =
  | { outcome: "changed"; event: StatusEvent }
  | { outcome: "unchanged" }
  | { outcome: "not-found" };

/** Moves an application to `to` and records the change; `sentVia` says how, when this is its first send (E29-7). */
export async function applyStatusChange(
  db: PrismaClient,
  applicationId: string,
  to: ApplicationStatus,
  now = new Date(),
  { sentVia }: { sentVia?: SentVia } = {},
): Promise<StatusChangeResult> {
  return db.$transaction(async (tx) => {
    // Lock the row so two changes to the same application can't interleave:
    // a write that changes nothing locks it in PostgreSQL and SQLite alike.
    await tx.$executeRaw`UPDATE "Application" SET id = id WHERE id = ${applicationId}`;
    const application = await tx.application.findUnique({
      where: { id: applicationId },
      select: { status: true, furthestStage: true, sentAt: true, boardSort: true },
    });
    if (!application) return { outcome: "not-found" };

    const change = advance(application, to, now);
    if (!change) return { outcome: "unchanged" };

    // Its first send: from here on it keeps what it was sent with (#299).
    const firstSend = application.sentAt === null && change.update.sentAt !== null;
    // Without a place, it goes on top of its new column (public issue 60).
    await tx.application.update({
      where: { id: applicationId },
      data: { ...change.update, boardSort: null, ...(firstSend ? { ...(await frozenDataForSend(tx, applicationId)), ...(sentVia ? { sentVia } : {}) } : {}) },
    });
    const event = await tx.statusEvent.create({ data: { applicationId, ...change.event, previousBoardSort: application.boardSort } });
    return { outcome: "changed", event };
  });
}

export type UndoResult =
  | { outcome: "undone"; status: ApplicationStatus }
  | { outcome: "superseded" }
  | { outcome: "not-found" };

/**
 * Undoes a status change: restores the status, furthest stage, sent date and
 * place on the board from before it and deletes its event. Only the application's latest change
 * can be undone; after a newer one, the result is "superseded".
 */
export async function undoStatusChange(db: PrismaClient, eventId: string): Promise<UndoResult> {
  return db.$transaction(async (tx) => {
    const event = await tx.statusEvent.findUnique({ where: { id: eventId } });
    if (!event) return { outcome: "not-found" };

    await tx.$executeRaw`UPDATE "Application" SET id = id WHERE id = ${event.applicationId}`;
    const latest = await tx.statusEvent.findFirst({
      where: { applicationId: event.applicationId },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (latest?.id !== event.id) return { outcome: "superseded" };

    const restored = undoChange(event);
    // Undoing the first send means it was never sent: it follows the profile again (#299).
    const { frozen } = await tx.application.findUniqueOrThrow({ where: { id: event.applicationId }, select: { frozen: true } });
    await tx.application.update({
      where: { id: event.applicationId },
      // Never sent after all: nor how (E29-7).
      data: { ...restored, boardSort: event.previousBoardSort, ...(restored.sentAt === null ? { sentVia: null } : {}), ...(restored.sentAt === null && frozen !== null ? unfrozenData(frozen) : {}) },
    });
    await tx.statusEvent.delete({ where: { id: event.id } });
    return { outcome: "undone", status: restored.status };
  });
}
