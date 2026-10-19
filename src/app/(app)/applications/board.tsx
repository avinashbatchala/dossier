"use client";

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";

import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { statusLabel } from "@/lib/applications-list";
import { cn } from "@/lib/cn";

import { RowMenu } from "./row-menu";

/**
 * The board (LST-3, LST-4): a column per status in the filter, cards newest
 * first. Drag a card to another column to move it; each card also has a
 * "Move to…" menu for the keyboard and touch. Clicking a card opens it.
 * It fills the height it's given: each column's cards scroll on their own.
 */
export function Board({
  rows,
  statuses,
  onMove,
}: {
  rows: ApplicationRow[];
  statuses: ApplicationStatus[];
  onMove: (row: ApplicationRow, to: ApplicationStatus) => void;
}) {
  const [dragging, setDragging] = useState<ApplicationRow | null>(null);
  // A drag ends with a click on some browsers; it mustn't open the card.
  const draggedAt = useRef(0);
  const sensors = useSensors(
    // A few pixels of movement first, so a click still opens the card…
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // …and a press-and-hold on touch screens, so swiping still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const start = ({ active }: DragStartEvent) => setDragging(rows.find((row) => row.id === active.id) ?? null);
  const end = ({ active, over }: DragEndEvent) => {
    draggedAt.current = Date.now();
    setDragging(null);
    const row = rows.find((entry) => entry.id === active.id);
    const to = over?.id as ApplicationStatus | undefined;
    if (row && to && to !== row.status) onMove(row, to);
  };

  const byNewest = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  const name = (row: ApplicationRow) => [row.role, row.company].filter(Boolean).join(" at ");

  return (
    <DndContext
      id="applications-board"
      sensors={sensors}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${name(rows.find((row) => row.id === active.id)!)}.`,
          onDragOver: ({ over }) => (over ? `Over ${statusLabel(over.id as ApplicationStatus)}.` : "Not over a column."),
          onDragEnd: ({ over }) => (over ? `Dropped on ${statusLabel(over.id as ApplicationStatus)}.` : "Dropped back where it was."),
          onDragCancel: () => "Moving cancelled.",
        },
      }}
    >
      {/* Relative, so screen-reader-only text inside is clipped with the rest
          instead of widening the page. */}
      <div className="relative min-h-0 flex-1 scrollbar-subtle overflow-x-auto overflow-y-hidden px-10 pt-1.5 pb-5">
        <div className="flex h-full w-max items-stretch gap-3.5">
          {statuses.map((status) => {
            const cards = byNewest.filter((row) => row.status === status);
            return (
              <Column key={status} status={status} count={cards.length}>
                {cards.map((row) => (
                  <Card
                    key={row.id}
                    row={row}
                    dimmed={dragging?.id === row.id}
                    onOpen={(event) => Date.now() - draggedAt.current < 300 && event.preventDefault()}
                    onMove={(to) => onMove(row, to)}
                  />
                ))}
              </Column>
            );
          })}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <CardFace row={dragging} lifted />}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, count, children }: { status: ApplicationStatus; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `board-${status}`;
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex min-h-0 w-[252px] flex-none flex-col gap-2.5 rounded-panel p-3 outline-[1.5px] -outline-offset-2 motion-safe:transition-colors",
        isOver ? "bg-selected outline-dashed outline-line-strong" : "bg-track outline-transparent",
      )}
    >
      <h2 id={headingId} className="flex items-center gap-2 px-1 pt-1 pb-0.5">
        <StatusDot status={status} />
        <span className="flex-1 text-control font-medium">{statusLabel(status)}</span>{" "}
        <span className="text-label text-muted tabular-nums">
          {count}{" "}
          <span className="sr-only">{count === 1 ? "application" : "applications"}</span>
        </span>
      </h2>
      {count > 0 ? (
        // Scrolls on its own, out to the column's edges so its scrollbar sits
        // at the side and focus rings aren't cut off; the heading stays.
        <ul className="-mx-3 -mt-1 -mb-3 flex min-h-0 flex-1 scrollbar-subtle flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-3">{children}</ul>
      ) : (
        <p className="px-2.5 py-5 text-center text-label text-muted">Nothing here yet</p>
      )}
    </section>
  );
}

function Card({
  row,
  dimmed,
  onOpen,
  onMove,
}: {
  row: ApplicationRow;
  dimmed: boolean;
  onOpen: (event: React.MouseEvent) => void;
  onMove: (to: ApplicationStatus) => void;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: row.id });
  return (
    <li ref={setNodeRef} {...listeners} className={cn("relative touch-manipulation", dimmed && "opacity-40")}>
      <CardFace row={row} onOpen={onOpen} />
      <div className="absolute top-2 right-2">
        <RowMenu row={row} onMove={onMove} />
      </div>
    </li>
  );
}

/** What a card shows; also the copy that follows the pointer while dragging. */
function CardFace({ row, lifted = false, onOpen }: { row: ApplicationRow; lifted?: boolean; onOpen?: (event: React.MouseEvent) => void }) {
  const place = [row.location, row.mode].filter(Boolean).join(" · ");
  return (
    <div
      className={cn(
        "group flex cursor-grab flex-col gap-1.5 rounded-[10px] border border-line-card bg-card p-3.5 pr-9 shadow-control hover:border-line-strong",
        lifted && "cursor-grabbing shadow-menu",
      )}
    >
      <p className="flex items-baseline justify-between gap-2 text-label text-muted">
        {row.company || "No company"}
        {row.archived && <span className="rounded-[6px] bg-track px-1.5 text-xs">Archived</span>}
      </p>
      {/* The link covers the card, so clicking anywhere opens it. */}
      <Link
        href={`/applications/${row.id}`}
        onClick={onOpen}
        draggable={false}
        className="text-field leading-[1.35] font-medium text-pretty text-ink after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
      >
        {row.role}
      </Link>
      {place && <p className="text-label text-muted">{place}</p>}
      {row.status === "DRAFT" && row.deadline && (
        <p className="flex">
          <span className="rounded-[6px] bg-warning-surface px-2 py-[3px] text-xs text-warning">Apply by {row.deadline}</span>
        </p>
      )}
      <p className="mt-0.5 flex justify-between gap-2 border-t border-line pt-1.5 text-xs text-muted">
        <span>{row.match ? `${row.match.hit}/${row.match.total} match` : "Not matched"}</span>
        <span>{row.updated}</span>
      </p>
    </div>
  );
}
