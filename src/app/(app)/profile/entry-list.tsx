"use client";

import { closestCenter, DndContext, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";
import type { EntryOrder } from "@/lib/profile";

import { AddEntryButton, DragHandle, EmptyEntries, EntryCard, type Reorder } from "./entry-card";
import { useTrackSave } from "@/components/save-tracker";

type Summary = { title: string; subtitle: string; meta?: string; footnote?: string };

/** How a list can be reordered (E4-9): by date until an entry is moved, then by hand. */
export type Ordering = {
  mode: EntryOrder;
  /** Saves an order set by hand: every entry's id, in order. */
  save: (ids: string[]) => Promise<ActionResult<null>>;
  /** Back to date order; answers with the ids in that order. Without it, the entries have no dates and only an order set by hand (#218). */
  sortByDate?: () => Promise<ActionResult<string[]>>;
};

/**
 * A list of entries (experience, education, publications, references): one card open at a
 * time, "+ Add…" creates a blank entry and opens it, and Remove takes effect
 * at once with Undo in the toast (#36). With `ordering`, entries can be
 * dragged or moved up and down (E4-9).
 */
export function EntryList<T extends { id: string }>({
  items,
  setItems,
  addLabel,
  summary,
  create,
  remove,
  restore,
  ordering,
  renderForm,
}: {
  items: T[];
  setItems: (change: (items: T[]) => T[]) => void;
  /** "Add a role" */
  addLabel: string;
  summary: (item: T) => Summary;
  create: () => Promise<ActionResult<T>>;
  remove: (item: T) => Promise<ActionResult<null>>;
  restore: (item: T) => Promise<ActionResult<T>>;
  ordering?: Ordering;
  /** The open card's fields; `autoFocus` is set on an entry that was just added. */
  renderForm: (item: T, options: { onChange: (item: T) => void; autoFocus: boolean }) => ReactNode;
}) {
  const track = useTrackSave();
  const [openId, setOpenId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<EntryOrder>(ordering?.mode ?? "date");
  const [announcement, setAnnouncement] = useState("");
  const dndId = useId();

  // For the toast's Undo, which runs after later changes.
  const latest = useRef({ items, mode });
  useEffect(() => {
    latest.current = { items, mode };
  });

  const replace = (next: T) => setItems((current) => current.map((item) => (item.id === next.id ? next : item)));

  async function add() {
    setAdding(true);
    const result = await track(create());
    setAdding(false);
    if (!result.ok) return toast(result.error);
    // A new entry has no dates yet: last by date, first in an order set by hand.
    setItems((current) => (ordering && mode === "manual" ? [result.data, ...current] : [...current, result.data]));
    setOpenId(result.data.id);
    setCreatedId(result.data.id);
  }

  async function removeItem(item: T) {
    const index = items.findIndex((entry) => entry.id === item.id);
    const putBack = (restored: T) => {
      const next = latest.current.items.toSpliced(Math.min(index, latest.current.items.length), 0, restored);
      setItems(() => next);
      // Back in its place in an order set by hand, not last.
      if (ordering && latest.current.mode === "manual") void track(ordering.save(next.map((entry) => entry.id)));
    };

    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setOpenId(null);
    const result = await track(remove(item));
    if (!result.ok) {
      putBack(item);
      return toast(result.error);
    }

    const { title } = summary(item);
    toast(`Removed “${title}”.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await track(restore(item));
          if (!restored.ok) return toast(restored.error);
          putBack(restored.data);
          toast(`Put back “${title}”.`);
        },
      },
    });
  }

  async function move(from: number, to: number) {
    if (!ordering || from === to || to < 0 || to >= items.length) return;
    const before = { items, mode };
    const next = arrayMove(items, from, to);
    setItems(() => next);
    setMode("manual");
    setAnnouncement(`“${summary(items[from]).title}” moved to position ${to + 1} of ${items.length}.`);
    const result = await track(ordering.save(next.map((item) => item.id)));
    if (!result.ok) {
      setItems(() => before.items);
      setMode(before.mode);
      toast(result.error);
    }
  }

  async function sortByDate() {
    if (!ordering?.sortByDate) return;
    const result = await track(ordering.sortByDate());
    if (!result.ok) return toast(result.error);
    const position = new Map(result.data.map((id, index) => [id, index]));
    setItems((current) => current.toSorted((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity)));
    setMode("date");
    setAnnouncement("Sorted by date, newest first.");
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const indexOf = (id: unknown) => items.findIndex((item) => item.id === id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over) void move(indexOf(active.id), indexOf(over.id));
  };

  const cards = items.map((item, index) => {
    const card = (reorder?: Reorder) => (
      <EntryCard
        {...summary(item)}
        open={openId === item.id}
        onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
        onRemove={() => void removeItem(item)}
        reorder={reorder}
      >
        {renderForm(item, { onChange: replace, autoFocus: createdId === item.id })}
      </EntryCard>
    );
    if (!ordering || items.length < 2) return <div key={item.id}>{card()}</div>;
    return (
      <SortableEntry key={item.id} id={item.id}>
        {(handle) =>
          card({
            handle,
            first: index === 0,
            last: index === items.length - 1,
            moveUp: () => void move(index, index - 1),
            moveDown: () => void move(index, index + 1),
          })
        }
      </SortableEntry>
    );
  });

  return (
    <div className="flex flex-col gap-3">
      {ordering && items.length > 1 && (
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-meta text-muted">
          {!ordering.sortByDate ? (
            <span>In your own order. Drag an entry or use its arrows to move it.</span>
          ) : mode === "manual" ? (
            <>
              <span>In your own order.</span>
              <Button variant="text" size="sm" onClick={() => void sortByDate()}>
                Sort by date
              </Button>
            </>
          ) : (
            <span>Newest first. Drag an entry or use its arrows to set your own order.</span>
          )}
        </div>
      )}
      {items.length === 0 && <EmptyEntries />}
      {ordering && items.length > 1 ? (
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            announcements: {
              onDragStart: ({ active }) => `Picked up “${summary(items[indexOf(active.id)]).title}”.`,
              onDragOver: ({ over }) => (over ? `Over position ${indexOf(over.id) + 1} of ${items.length}.` : "Not over the list."),
              onDragEnd: ({ over }) => (over ? `Dropped at position ${indexOf(over.id) + 1} of ${items.length}.` : "Dropped back where it was."),
              onDragCancel: () => "Moving cancelled.",
            },
          }}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            {cards}
          </SortableContext>
        </DndContext>
      ) : (
        cards
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      <AddEntryButton onClick={() => void add()} disabled={adding}>
        {addLabel}
      </AddEntryButton>
    </div>
  );
}

/** A card that follows the pointer while it's dragged by its handle. */
function SortableEntry({ id, children }: { id: string; children: (handle: ReactNode) => ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-90 shadow-menu" : undefined}
    >
      {children(<DragHandle ref={setActivatorNodeRef} {...listeners} />)}
    </div>
  );
}
