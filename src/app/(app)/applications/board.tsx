"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { List } from "lucide-react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ScoreRing } from "@/components/score-ring";
import { toastResult } from "@/components/toast";
import { buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { actionHref, rowAction, statusHref, statusLabel, type StatusParam } from "@/lib/applications-list";
import { statusInfo } from "@/lib/status";
import { orderedColumn } from "@/lib/board-order";
import { cn } from "@/lib/cn";

import { setInterviewDate } from "./[id]/actions";
import { InterviewForm } from "./[id]/interview-date";
import { RowMenu } from "./row-menu";

/**
 * The board (LST-3, LST-4): a column per status in the filter, cards in
 * board order (public issue 60). Drag a card to another column to move it,
 * or within its column to reorder it; each card also has a "Move to…" menu
 * and Move up / Move down for the keyboard and touch. Clicking a card opens
 * it. It fills the height it's given: each column's cards scroll on their
 * own.
 */
export function Board({
  rows,
  statuses,
  onMove: move,
  onReorder,
  notes = {},
  openClosed = false,
  calendar = false,
  highlight = null,
}: {
  rows: ApplicationRow[];
  statuses: ApplicationStatus[];
  onMove: (row: ApplicationRow, to: ApplicationStatus) => void;
  /** A column's cards in their new order, after a drag or a menu move. */
  onReorder: (ordered: ApplicationRow[]) => void;
  /** Each open lane's sub-line (E29-3). */
  notes?: Partial<Record<ApplicationStatus, string>>;
  /** Closed is on show: Accepted, Rejected and Declined open as normal lanes (LB2). */
  openClosed?: boolean;
  /** Google's calendar is in use: the interview popover offers "Add to Google Calendar" (LB3). */
  calendar?: boolean;
  /** The status the board was opened on, whose lane is picked out (E29-6). */
  highlight?: StatusParam | null;
}) {
  // Picked out until Esc, or until another status is opened.
  const [picked, setPicked] = useState(highlight);
  const [openedOn, setOpenedOn] = useState(highlight);
  if (highlight !== openedOn) {
    setOpenedOn(highlight);
    setPicked(highlight);
  }
  useEffect(() => {
    if (!picked) return;
    const clear = (event: KeyboardEvent) => event.key === "Escape" && setPicked(null);
    document.addEventListener("keydown", clear);
    return () => document.removeEventListener("keydown", clear);
  }, [picked]);
  const isPicked = (status: ApplicationStatus) => picked === status || (picked === "closed" && FOLDED.includes(status));
  // The card just moved to Interview, which asks when the interview is (E29-5).
  const [asking, setAsking] = useState<string | null>(null);
  const onMove = (row: ApplicationRow, to: ApplicationStatus) => {
    move(row, to);
    if (to === "INTERVIEW" && row.status !== "INTERVIEW") setAsking(row.id);
  };
  const [dragging, setDragging] = useState<ApplicationRow | null>(null);
  // The closed lanes opened by a click; they fold again on the next visit (LB2).
  const [opened, setOpened] = useState<ApplicationStatus[]>([]);
  const folded = (status: ApplicationStatus) => !openClosed && FOLDED.includes(status) && !opened.includes(status);
  // A drag ends with a click on some browsers; it mustn't open the card.
  const draggedAt = useRef(0);
  const sensors = useSensors(
    // A few pixels of movement first, so a click still opens the card…
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // …and a press-and-hold on touch screens, so swiping still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const columnOf = new Map(rows.map((row) => [row.id, row.status]));
  const columnName = (id: UniqueIdentifier) => statusLabel(columnOf.get(String(id)) ?? (id as ApplicationStatus));

  // The column under the pointer decides, or the one the card overlaps most
  // when the pointer's between columns, then the closest card in it. Off the
  // columns there's nothing to drop on, so the card stays where it was.
  const collisions: CollisionDetection = ({ droppableContainers, ...args }) => {
    const columns = droppableContainers.filter(({ id }) => !columnOf.has(String(id)));
    const [column] = [...pointerWithin({ ...args, droppableContainers: columns }), ...rectIntersection({ ...args, droppableContainers: columns })];
    if (!column) return [];
    const cards = droppableContainers.filter(({ id }) => columnOf.get(String(id)) === column.id);
    return cards.length > 0 ? closestCenter({ ...args, droppableContainers: cards }) : [column];
  };

  const place = (row: ApplicationRow, at: number) => {
    const cards = orderedColumn(rows, row.status);
    const from = cards.findIndex((card) => card.id === row.id);
    if (at !== from) onReorder(arrayMove(cards, from, at));
  };

  const start = ({ active }: DragStartEvent) => setDragging(rows.find((row) => row.id === active.id) ?? null);
  const end = ({ active, over }: DragEndEvent) => {
    draggedAt.current = Date.now();
    setDragging(null);
    const row = rows.find((entry) => entry.id === active.id);
    if (!row || !over) return;
    // Over a card, or over the column itself when it's empty.
    const to = columnOf.get(String(over.id)) ?? (over.id as ApplicationStatus);
    if (to !== row.status) onMove(row, to);
    else place(row, orderedColumn(rows, to).findIndex((card) => card.id === over.id));
  };

  const name = (row: ApplicationRow) => [row.role, row.company].filter(Boolean).join(" at ");

  return (
    <DndContext
      id="applications-board"
      sensors={sensors}
      collisionDetection={collisions}
      onDragStart={start}
      onDragEnd={end}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${name(rows.find((row) => row.id === active.id)!)}.`,
          onDragOver: ({ over }) => (over ? `Over ${columnName(over.id)}.` : "Not over a column."),
          onDragEnd: ({ over }) => (over ? `Dropped on ${columnName(over.id)}.` : "Dropped back where it was."),
          onDragCancel: () => "Moving cancelled.",
        },
      }}
    >
      {/* Relative, so screen-reader-only text inside is clipped with the rest
          instead of widening the page. */}
      <div className="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-10 pt-1.5 pb-5">
        <div className="flex h-full min-w-full items-stretch gap-3">
          {statuses.map((status) => {
            const cards = orderedColumn(rows, status);
            if (folded(status)) return <FoldedColumn key={status} status={status} count={cards.length} onOpen={() => setOpened([...opened, status])} />;
            return (
              <Column key={status} status={status} count={cards.length} note={notes[status]} picked={isPicked(status)} items={cards.map((card) => card.id)}>
                {cards.map((row, index) => (
                  <Card
                    key={row.id}
                    row={row}
                    asking={asking === row.id}
                    calendar={calendar}
                    onAsked={() => setAsking(null)}
                    dimmed={dragging?.id === row.id}
                    onOpen={(event) => Date.now() - draggedAt.current < 300 && event.preventDefault()}
                    onMove={(to) => onMove(row, to)}
                    onReorder={(direction) => place(row, index + (direction === "up" ? -1 : 1))}
                    canMoveUp={index > 0}
                    canMoveDown={index < cards.length - 1}
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

/** Folded by default (LB2): the closed statuses, in slim columns on the right. */
const FOLDED: readonly ApplicationStatus[] = ["ACCEPTED", "REJECTED", "DECLINED"];

/** What dropping a card on an empty lane does (E29-3). */
const EMPTY: Record<ApplicationStatus, string> = {
  DRAFT: "Drop a card here to move it back to draft.",
  SENT: "Drop a card here once it's sent.",
  SCREENING: "Drop a card here when they get back to you.",
  INTERVIEW: "Drop a card here, and I'll ask when the interview is.",
  OFFER: "Drop a card here when there's an offer.",
  ACCEPTED: "Drop a card here when you accept.",
  REJECTED: "Drop a card here if they say no.",
  DECLINED: "Drop a card here if you say no.",
};

/** A status's list, from a lane's ☰. */
const laneList = (status: ApplicationStatus) => `${statusHref(status)}&view=list`;

/** A closed lane folded into a 52px column (LB2): its dot, count and name upright; a click opens it. A card can still be dropped on it. */
function FoldedColumn({ status, count, onOpen }: { status: ApplicationStatus; count: number; onOpen: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section ref={setNodeRef} aria-label={`${statusLabel(status)}, folded`} className={cn("flex w-[52px] flex-none rounded-panel", isOver ? "bg-selected" : "bg-track")}>
      {/* Named by what it shows, "Open 1 Rejected", so the visible text is in its name. */}
      <button type="button" onClick={onOpen} title={`Open ${statusLabel(status)}`} className="flex w-full flex-col items-center gap-2 rounded-panel px-1 pt-4 pb-3 hover:bg-hover">
        <span className="sr-only">Open</span>{" "}
        <StatusDot status={status} />
        <span className="text-label text-muted tabular-nums">{count}</span>{" "}
        <span className="text-control font-medium [writing-mode:vertical-rl]">{statusLabel(status)}</span>
      </button>
    </section>
  );
}

function Column({
  status,
  count,
  note,
  picked = false,
  items,
  children,
}: {
  status: ApplicationStatus;
  count: number;
  note?: string;
  /** The status the board was opened on (E29-6): picked out in its colour. */
  picked?: boolean;
  items: string[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver, over } = useDroppable({ id: status });
  const headingId = `board-${status}`;
  const dropping = isOver || items.includes(String(over?.id));
  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      aria-current={picked ? "true" : undefined}
      style={picked && !dropping ? { outlineColor: statusInfo(status).color } : undefined}
      className={cn(
        "flex min-h-0 min-w-[212px] flex-[1_1_0px] flex-col gap-2.5 rounded-panel p-3 outline-[1.5px] -outline-offset-2 motion-safe:transition-colors",
        dropping ? "bg-selected outline-dashed outline-line-strong" : picked ? "bg-selected outline-solid" : "bg-track outline-transparent",
      )}
    >
      <div className="flex flex-col gap-0.5 px-1 pt-1 pb-0.5">
        <div className="flex items-center gap-2">
          <h2 id={headingId} className="flex flex-1 items-center gap-2">
            <StatusDot status={status} />
            <span className="flex-1 text-control font-medium">{statusLabel(status)}</span>{" "}
            <span className="text-label text-muted tabular-nums">
              {count}{" "}
              <span className="sr-only">{count === 1 ? "application" : "applications"}</span>
            </span>
          </h2>
          <Link href={laneList(status)} aria-label={`${statusLabel(status)} as a list`} title="Open as a list" className="grid size-6 place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink">
            <List size={14} aria-hidden="true" />
          </Link>
        </div>
        {picked ? (
          <p className="text-xs text-muted">
            Opened from the sidebar ·{" "}
            <Link href={laneList(status)} className="text-ink underline underline-offset-2">
              show only {statusLabel(status)}
            </Link>
          </p>
        ) : (
          note && <p className="text-xs text-muted">{note}</p>
        )}
      </div>
      {count > 0 ? (
        // Scrolls on its own, out to the column's edges so its scrollbar sits
        // at the side and focus rings aren't cut off; the heading stays.
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <ul className="-mx-3 -mt-1 -mb-3 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pt-1 pb-3">{children}</ul>
        </SortableContext>
      ) : (
        <p className="px-2.5 py-5 text-center text-label text-pretty text-muted">{EMPTY[status]}</p>
      )}
    </section>
  );
}

function Card({
  row,
  asking,
  calendar,
  onAsked,
  dimmed,
  onOpen,
  onMove,
  onReorder,
  canMoveUp,
  canMoveDown,
}: {
  row: ApplicationRow;
  /** Just moved to Interview: the popover under it asks when the interview is (E29-5). */
  asking: boolean;
  calendar: boolean;
  onAsked: () => void;
  dimmed: boolean;
  onOpen: (event: React.MouseEvent) => void;
  onMove: (to: ApplicationStatus) => void;
  onReorder: (direction: "up" | "down") => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { setNodeRef, listeners, transform, transition } = useSortable({ id: row.id });
  const save = (at: Date | null, { calendar: inCalendar }: { calendar: boolean }) => {
    onAsked();
    if (at) void setInterviewDate({ id: row.id, at: at.toISOString(), calendar: inCalendar }).then(toastResult);
  };
  return (
    <Popover.Root open={asking} onOpenChange={(open) => !open && onAsked()}>
      <Popover.Anchor asChild>
        <li
          ref={setNodeRef}
          {...listeners}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          className={cn("relative touch-manipulation", dimmed && "opacity-40")}
        >
          <CardFace row={row} onOpen={onOpen} />
          <div className="absolute top-2 right-2">
            <RowMenu row={row} onMove={onMove} onReorder={onReorder} canMoveUp={canMoveUp} canMoveDown={canMoveDown} />
          </div>
        </li>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label="When's the interview?"
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-30 w-[min(320px,calc(100vw-32px))] rounded-card border border-line-popover bg-card p-5 shadow-menu motion-safe:animate-toast-in"
        >
          <InterviewForm initial={null} asking calendar={calendar} skipLabel="Not yet known" onSave={save} onCancel={onAsked} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** What a card shows; also the copy that follows the pointer while dragging. */
function CardFace({ row, lifted = false, onOpen }: { row: ApplicationRow; lifted?: boolean; onOpen?: (event: React.MouseEvent) => void }) {
  const place = [row.location, row.mode].filter(Boolean).join(" · ");
  const action = rowAction(row, "card");
  // The button opens the application rather than starting a drag (E29-4).
  const stay = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className={cn(
        "group flex cursor-grab flex-col gap-1 rounded-[10px] border border-line-card bg-card px-3.5 pt-3 pb-2.5 shadow-control hover:border-line-strong",
        lifted && "cursor-grabbing shadow-menu",
      )}
    >
      {/* Line 1: the company and the coverage ring; the ⋯ menu sits at the end. */}
      <p className="flex min-h-[22px] items-center gap-2 pr-7 text-label text-muted">
        <span className="min-w-0 flex-1 truncate">{row.company || "No company"}</span>
        {row.archived && <span className="rounded-[6px] bg-track px-1.5 text-xs">Archived</span>}
        {row.match && <ScoreRing hit={row.match.hit} total={row.match.total} size="sm" />}
      </p>
      {/* The link covers the card, so clicking anywhere opens it. */}
      <Link
        href={`/applications/${row.id}`}
        onClick={onOpen}
        draggable={false}
        className="text-[14.5px] leading-[1.35] font-medium text-pretty text-ink after:absolute after:inset-0 after:rounded-[10px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
      >
        {row.role}
      </Link>
      {place && <p className="text-label text-muted">{place}</p>}
      {/* The footer: what it needs next, on its own line so it never squeezes, then the button for it and when it last changed. */}
      <div className="mt-1.5 flex flex-col gap-1.5 border-t border-line pt-2 text-xs">
        {row.flag && <span className={cn("text-pretty", row.flag.soon ? "text-warning" : "text-muted")}>{row.flag.text}</span>}
        <div className="flex min-h-7 items-center gap-2">
          {action && (
            <Link
              href={actionHref(row.id, action)}
              onMouseDown={stay}
              onTouchStart={stay}
              onKeyDown={stay}
              draggable={false}
              className={buttonClassName("secondary", "sm", "relative z-10 flex-none")}
            >
              {action.label} <span className="sr-only">for {[row.role, row.company].filter(Boolean).join(", ")}</span>
            </Link>
          )}
          <span className="ml-auto flex-none text-muted">{row.updated}</span>
        </div>
      </div>
    </div>
  );
}
