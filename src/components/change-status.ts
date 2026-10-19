"use client";

import type { ApplicationStatus } from "@/generated/prisma/enums";
import { setStatus, undoStatus } from "@/lib/status-actions";

import { toast, toastResult } from "./toast";

/**
 * Changes an application's status from the UI: shows the encouraging toast
 * with an Undo button for mis-clicks (APP-2, decision in #26), or the error.
 * Returns whether the change went through.
 */
export async function changeStatus(id: string, to: ApplicationStatus): Promise<boolean> {
  const result = await setStatus({ id, to });
  if (!result.ok) {
    toast(result.error);
    return false;
  }
  const { eventId } = result.data;
  if (eventId && result.toast) {
    toast(result.toast, {
      action: { label: "Undo", onClick: () => void undoStatus({ eventId }).then(toastResult) },
    });
  }
  return true;
}

/** A toast for a status change made elsewhere (e.g. sending through Gmail), with Undo when there's an event. */
export function toastWithUndo(message: string | undefined, eventId: string | null): void {
  if (!message) return;
  if (!eventId) return toast(message);
  toast(message, { action: { label: "Undo", onClick: () => void undoStatus({ eventId }).then(toastResult) } });
}
