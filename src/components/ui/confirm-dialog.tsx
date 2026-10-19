"use client";

import { AlertDialog } from "radix-ui";
import type { ReactNode, RefObject } from "react";

import { buttonClassName } from "./button";

/**
 * Asks before something that can't be undone, e.g. deleting an
 * application. Built on Radix AlertDialog: focus starts on Cancel, Escape
 * cancels, and focus returns to what opened it, or to `returnFocusTo` when
 * that's gone, like the item of a menu (E11-3).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Says what happens, e.g. "Delete application". */
  confirmLabel: string;
  onConfirm: () => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <AlertDialog.Content
          onCloseAutoFocus={(event) => {
            if (!returnFocusTo?.current?.isConnected) return;
            event.preventDefault();
            returnFocusTo.current.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <AlertDialog.Title className="font-serif text-[22px] leading-tight">{title}</AlertDialog.Title>
          <AlertDialog.Description className="text-sm text-muted">{description}</AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialog.Cancel className={buttonClassName("secondary", "sm")}>Cancel</AlertDialog.Cancel>
            <AlertDialog.Action className={buttonClassName("danger", "sm")} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
