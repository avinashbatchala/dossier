"use client";

import { closestCenter, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useId, type ComponentProps, type ReactNode } from "react";

/** A list of rows to drag or move with buttons, for a DndContext: `move` is for the buttons, `context` for its props. */
export function useRowSorting({
  keys,
  nameOf,
  onMove,
  announce,
}: {
  keys: string[];
  nameOf: (key: string) => string;
  /** `keys` in their new order. */
  onMove: (keys: string[]) => void;
  announce: (message: string) => void;
}) {
  const id = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const indexOf = (key: unknown) => keys.findIndex((entry) => entry === key);
  const name = (key: unknown) => nameOf(String(key));

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= keys.length) return;
    onMove(arrayMove(keys, from, to));
    announce(`“${name(keys[from])}” moved to position ${to + 1} of ${keys.length}.`);
  };

  return {
    move,
    context: {
      id,
      sensors,
      collisionDetection: closestCenter,
      onDragEnd: ({ active, over }: DragEndEvent) => {
        if (over) move(indexOf(active.id), indexOf(over.id));
      },
      accessibility: {
        announcements: {
          onDragStart: ({ active }: { active: { id: unknown } }) => `Picked up “${name(active.id)}”.`,
          onDragOver: ({ over }: { over: { id: unknown } | null }) => (over ? `Over position ${indexOf(over.id) + 1} of ${keys.length}.` : "Not over the list."),
          onDragEnd: ({ over }: { over: { id: unknown } | null }) => (over ? `Dropped at position ${indexOf(over.id) + 1} of ${keys.length}.` : "Dropped back where it was."),
          onDragCancel: () => "Moving cancelled.",
        },
      },
    },
  };
}

/** The handle to drag something by, for the pointer; the Move buttons are the keyboard's way. */
export function DragHandle({ ref, ...props }: ComponentProps<"span">) {
  return (
    <span
      ref={ref}
      {...props}
      aria-hidden="true"
      title="Drag to reorder"
      className="flex w-7 flex-none cursor-grab touch-none items-center justify-end text-base text-faint select-none hover:text-muted active:cursor-grabbing"
    >
      ⠿
    </span>
  );
}

/** ↑ or ↓: stays focusable at the ends (aria-disabled), so focus isn't lost after the last move. */
export function MoveButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onClick()}
      className="grid size-6 place-items-center rounded-[6px] text-sm leading-none text-muted hover:bg-hover hover:text-ink aria-disabled:cursor-default aria-disabled:text-faint aria-disabled:hover:bg-transparent"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
