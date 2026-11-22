"use client";

import { useRef, useState, type SyntheticEvent } from "react";

import { archiveApplication, DeleteApplicationDialog } from "@/components/application-lifecycle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { STATUSES } from "@/lib/status";

/**
 * The "⋯" menu on a card or a table row: "Move to…" any status, the
 * keyboard and touch alternative to dragging (decided 28 September 2026),
 * then Archive and Delete (E9-5). On the board, it also reorders the card
 * inside its column (public issue 60); the table leaves that out.
 */
export function RowMenu({
  row,
  onMove,
  onReorder,
  canMoveUp,
  canMoveDown,
}: {
  row: ApplicationRow;
  onMove: (to: ApplicationStatus) => void;
  onReorder?: (direction: "up" | "down") => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    // The menu and the dialog open in portals, but React still passes their
    // events up to the card and the row: pressing in them mustn't start a
    // drag, and clicking in them mustn't open the application.
    <div className="contents" onMouseDown={stop} onTouchStart={stop} onClick={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label={`Actions for ${[row.role, row.company].filter(Boolean).join(", ")}`}
          className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ⋯
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto">
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={row.status} onValueChange={(value) => value !== row.status && onMove(value as ApplicationStatus)}>
            {STATUSES.map((status) => (
              <DropdownMenuRadioItem key={status.value} value={status.value}>
                <StatusDot status={status.value} />
                {status.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {onReorder && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onReorder("up")} disabled={!canMoveUp}>
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onReorder("down")} disabled={!canMoveDown}>
                Move down
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void archiveApplication(row.id, !row.archived)}>
            {row.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)} className="text-danger data-highlighted:text-error-strong">
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteApplicationDialog id={row.id} open={deleting} onOpenChange={setDeleting} returnFocusTo={trigger} />
    </div>
  );
}
