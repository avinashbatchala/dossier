"use client";

import type { RefObject } from "react";

import { deleteApplication, setArchived } from "@/lib/application-actions";

import { toast, toastResult } from "./toast";
import { ConfirmDialog } from "./ui/confirm-dialog";

/**
 * Archives an application or brings it back (E9-5), with Undo on the
 * toast. Returns whether it worked.
 */
export async function archiveApplication(id: string, archived: boolean): Promise<boolean> {
  const result = await setArchived({ id, archived });
  if (!result.ok) {
    toast(result.error);
    return false;
  }
  if (archived) {
    toast("Archived. It's off your board, and still counts on your dashboard.", {
      action: { label: "Undo", onClick: () => void setArchived({ id, archived: false }).then(toastResult) },
    });
  } else {
    toast("Back on your board.");
  }
  return true;
}

/** "Delete…": asks first, since the application, its documents, chat and notes can't come back. */
export function DeleteApplicationDialog({
  id,
  open,
  onOpenChange,
  onDeleted,
  returnFocusTo,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
  /** The menu button it was opened from. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete this application?"
      description="Its tailored resume and cover letter, the chat, your notes, its history and its mail from Gmail go with it. This can't be undone. Archive it instead to keep it out of the way."
      confirmLabel="Delete application"
      returnFocusTo={returnFocusTo}
      onConfirm={async () => {
        const result = await deleteApplication({ id });
        if (!result.ok) return toast(result.error);
        toast("Application deleted.");
        onDeleted?.();
      }}
    />
  );
}
