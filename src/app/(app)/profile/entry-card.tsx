"use client";

import { useId, type ReactNode } from "react";

import { DragHandle, MoveButton } from "@/components/reorder-controls";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export { DragHandle };

/** What an entry needs to be reordered (E4-9): its drag handle, and where it is for the Move buttons. */
export type Reorder = {
  handle: ReactNode;
  first: boolean;
  last: boolean;
  moveUp: () => void;
  moveDown: () => void;
};

/**
 * A collapsible entry, used for experience, education and references
 * (PRO-5): the closed card shows a summary; the open one shows the fields,
 * Remove and Done. The header is a button with `aria-expanded`.
 */
export function EntryCard({
  title,
  subtitle,
  meta,
  footnote,
  usage,
  used = false,
  note,
  warning,
  open,
  onToggle,
  onRemove,
  reorder,
  children,
}: {
  title: string;
  subtitle: string;
  meta?: string;
  /** An extra line on the closed card, e.g. the attached skills. */
  footnote?: string;
  /** On the open card's header (E33-2): "Used in 6 of 7 resumes", green when it's used at all. */
  usage?: string;
  used?: boolean;
  /** A last line on the closed card: "3 lines · used in 5 resumes". */
  note?: string;
  /** Something to fix (E33-2): a warning border and this line on the closed card, in place of the note. */
  warning?: string;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  /** A drag handle and Move up/down buttons, where entries can be reordered (E4-9). */
  reorder?: Reorder;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div
      className={cn(
        "overflow-hidden rounded-panel border bg-card",
        open ? "border-ink/30" : warning ? "border-warning-line" : "border-line-card",
      )}
    >
      <div className="flex">
        {reorder?.handle}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-4 py-5 pr-6 text-left focus-visible:-outline-offset-2",
            reorder ? "pl-3" : "pl-6",
          )}
        >
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-[15.5px] font-medium">{title}</span>
            <span className="text-control text-muted">{subtitle || "Not filled in yet"}</span>
            {meta && <span className="text-meta text-muted tabular-nums">{meta}</span>}
            {footnote && <span className="mt-[3px] text-label text-muted">{footnote}</span>}
            {!open && warning && <span className="mt-[3px] text-label text-warning">{warning}</span>}
            {!open && !warning && note && <span className="mt-[3px] text-label text-muted">{note}</span>}
          </span>
          {open && usage && <span className={cn("flex-none text-meta", used ? "text-success" : "text-muted")}>{usage}</span>}
          <span className="w-10 flex-none text-right text-meta text-muted">{open ? "Close" : "Edit"}</span>
        </button>
        {reorder && (
          <span className="flex flex-none flex-col justify-center gap-0.5 pr-3">
            <MoveButton label={`Move “${title}” up`} disabled={reorder.first} onClick={reorder.moveUp}>
              ↑
            </MoveButton>
            <MoveButton label={`Move “${title}” down`} disabled={reorder.last} onClick={reorder.moveDown}>
              ↓
            </MoveButton>
          </span>
        )}
      </div>
      {open && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-line px-6 pt-[22px] pb-6">
          {children}
          <div className="flex items-center justify-between">
            <Button variant="danger-text" size="sm" onClick={onRemove}>
              Remove
            </Button>
            <Button variant="secondary" size="sm" className="bg-input" onClick={onToggle}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "+ Add a role": the dashed button under a list of entries. */
export function AddEntryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-panel border border-dashed border-line-strong p-4 text-center text-sm hover:border-line-strong hover:bg-ink/[0.03] disabled:cursor-wait disabled:opacity-60"
    >
      + {children}
    </button>
  );
}

/** Shown when a list has no entries yet. */
export function EmptyEntries() {
  return (
    <div className="rounded-panel border border-dashed border-line-strong p-9 text-center text-sm text-muted">
      Nothing here yet. Add your first one below.
    </div>
  );
}
