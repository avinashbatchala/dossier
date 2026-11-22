"use client";

import { DndContext } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useState } from "react";

import { DragHandle, MoveButton, useRowSorting } from "@/components/reorder-controls";
import { cn } from "@/lib/cn";

import { useProfileId } from "./profile-id";
import { sectionHref, type NavSection, type ProfilePage } from "./sections";

/** How a section stands (E33-1): done, something to look at, or empty and optional. */
export type SectionStatus = "done" | "warn" | "empty";
type Row = NavSection & {
  status: SectionStatus;
  /** "3 roles · 1 without lines". */
  note: string;
  /** "All profiles" on a section every profile shares. */
  tag?: string;
};

const MARKS: Record<SectionStatus, { mark: string; label: string; className: string }> = {
  done: { mark: "✓", label: "Done", className: "text-success" },
  warn: { mark: "!", label: "Needs a look", className: "font-semibold text-warning" },
  empty: { mark: "·", label: "Empty", className: "text-muted" },
};

/**
 * The Profile page's sections (#337, E33-1): a link to each with how it
 * stands (✓, ! or ·), a note line and an "All profiles" tag on shared ones,
 * to drag or move with buttons. The buttons show when the row is hovered or
 * reached with the keyboard.
 */
export function SectionNav({ rows, current, onMove }: { rows: Row[]; current: ProfilePage; onMove: (rows: string[]) => void }) {
  const profileId = useProfileId();
  const [announcement, setAnnouncement] = useState("");
  const keys = rows.map((row) => row.id as string);
  const { move, context } = useRowSorting({ keys, nameOf: (key) => rows.find((row) => row.id === key)?.label ?? "", onMove, announce: setAnnouncement });

  return (
    <nav aria-label="Profile sections">
      <DndContext {...context}>
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {rows.map((row, index) => (
              <SectionRow
                key={row.id}
                row={row}
                selected={row.id === current}
                first={index === 0}
                last={index === rows.length - 1}
                moveUp={() => move(index, index - 1)}
                moveDown={() => move(index, index + 1)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <Link
        href={sectionHref("new", profileId)}
        aria-current={current === "new" ? "page" : undefined}
        className={cn("mt-0.5 block rounded-control py-[9px] pr-3 pl-8 text-sm text-muted hover:bg-hover hover:text-ink", current === "new" && "bg-selected font-medium text-ink hover:bg-selected")}
      >
        + Add a section
      </Link>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </nav>
  );
}

function SectionRow({ row, selected, first, last, moveUp, moveDown }: { row: Row; selected: boolean; first: boolean; last: boolean; moveUp: () => void; moveDown: () => void }) {
  const profileId = useProfileId();
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group flex items-center rounded-control pr-1 hover:bg-hover", selected && "bg-selected hover:bg-selected", isDragging && "relative z-10 bg-card opacity-90 shadow-menu")}
    >
      <DragHandle ref={setActivatorNodeRef} {...listeners} />
      <Link
        href={sectionHref(row.id, profileId)}
        aria-current={selected ? "page" : undefined}
        className="flex min-w-0 flex-1 items-start gap-2.5 py-2 pr-2 pl-1 text-ink hover:text-ink"
      >
        <span aria-hidden="true" className={cn("w-3 flex-none pt-0.5 text-center text-xs", MARKS[row.status].className)}>
          {MARKS[row.status].mark}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className={cn("truncate", selected && "font-medium")}>{row.label}</span>
            {row.tag && (
              <>
                {" "}
                {/* A line, not a fill: muted text on a fill over the selected row is too faint. */}
                <span className="flex-none rounded-[5px] border border-line px-1.5 text-[11px] font-normal text-muted">{row.tag}</span>
              </>
            )}
          </span>{" "}
          <span className={cn("truncate text-xs", row.status === "warn" ? "text-warning" : "text-muted")}>
            <span className="sr-only">{MARKS[row.status].label}:</span> {row.note}
          </span>
        </span>
      </Link>
      <span className="hidden flex-none gap-0.5 group-hover:flex group-has-focus-visible:flex">
        <MoveButton label={`Move “${row.label}” up`} disabled={first} onClick={moveUp}>
          ↑
        </MoveButton>
        <MoveButton label={`Move “${row.label}” down`} disabled={last} onClick={moveDown}>
          ↓
        </MoveButton>
      </span>
    </li>
  );
}
