"use client";

import { DndContext } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, type ReactNode } from "react";

import { RenameForm } from "@/components/documents/rename-section";
import { DragHandle, MoveButton, useRowSorting } from "@/components/reorder-controls";
import { Button } from "@/components/ui/button";

export type SectionRow = {
  key: string;
  name: string;
  hint?: string;
  /** A sidebar layout keeps it in the sidebar. */
  inSidebar: boolean;
  /** What it's usually called, when this resume can rename it (#339). */
  usual?: string;
};

/**
 * A resume's sections to drag or move with arrows (#297), on the Base resume
 * and on an application's Sections menu. With a sidebar, each column is its
 * own list: its sections can't leave it.
 */
export function SectionOrderList({
  rows,
  sidebar,
  onMove,
  onRemove,
  onRename,
  actions,
}: {
  rows: SectionRow[];
  /** The resume has a sidebar, so Skills and Languages are listed apart. */
  sidebar: boolean;
  /** `keys` are the sections of one list, in their new order. */
  onMove: (keys: string[]) => void;
  onRemove: (key: string) => void;
  /** A new heading for a row with `usual`; an empty one goes back to it. */
  onRename?: (key: string, title: string) => void;
  /** More for a row, on a line of their own, such as an Edit link. */
  actions?: (row: SectionRow) => ReactNode;
}) {
  const [announcement, setAnnouncement] = useState("");
  const list = (items: SectionRow[], label?: string) =>
    items.length > 0 && (
      <SectionGroup key={label ?? "all"} rows={items} label={label} onMove={onMove} onRemove={onRemove} onRename={onRename} actions={actions} announce={setAnnouncement} />
    );

  return (
    <div className="flex flex-col gap-4">
      {sidebar ? (
        <>
          {list(rows.filter((row) => !row.inSidebar), "Main column")}
          {list(rows.filter((row) => row.inSidebar), "Sidebar")}
        </>
      ) : (
        list(rows)
      )}
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function SectionGroup({
  rows,
  label,
  onMove,
  onRemove,
  onRename,
  actions,
  announce,
}: {
  rows: SectionRow[];
  label?: string;
  onMove: (keys: string[]) => void;
  onRemove: (key: string) => void;
  onRename?: (key: string, title: string) => void;
  actions?: (row: SectionRow) => ReactNode;
  announce: (message: string) => void;
}) {
  const keys = rows.map((row) => row.key);
  const { move, context } = useRowSorting({ keys, nameOf: (key) => rows.find((row) => row.key === key)?.name ?? "", onMove, announce });

  return (
    <div className="flex flex-col gap-1.5">
      {label && <p className="text-label text-muted">{label}</p>}
      <DndContext {...context}>
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-1.5">
            {rows.map((row, index) => (
              <SortableRow
                key={row.key}
                row={row}
                first={index === 0}
                last={index === rows.length - 1}
                moveUp={() => move(index, index - 1)}
                moveDown={() => move(index, index + 1)}
                onRemove={() => onRemove(row.key)}
                onRename={onRename && ((title) => onRename(row.key, title))}
                actions={actions?.(row)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow({
  row,
  first,
  last,
  moveUp,
  moveDown,
  onRemove,
  onRename,
  actions,
}: {
  row: SectionRow;
  first: boolean;
  last: boolean;
  moveUp: () => void;
  moveDown: () => void;
  onRemove: () => void;
  onRename?: (title: string) => void;
  actions?: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const canRename = onRename && row.usual !== undefined;
  const renamed = canRename && row.name !== row.usual;
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: row.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex flex-col rounded-control border border-line-card bg-card py-1 pr-1.5 ${isDragging ? "relative z-10 opacity-90 shadow-menu" : ""}`}
    >
      <div className="flex items-center gap-1">
        <DragHandle ref={setActivatorNodeRef} {...listeners} />
        <span className="flex min-w-0 flex-1 flex-col pl-1">
          <span className="truncate text-sm">{row.name}</span>
          {row.hint && <span className="truncate text-xs text-muted">{row.hint}</span>}
        </span>
        {canRename && !renaming && (
          <Button variant="text" size="sm" onClick={() => setRenaming(true)}>
            Rename <span className="sr-only">{row.name}</span>
          </Button>
        )}
        <Button variant="text" size="sm" onClick={onRemove}>
          Remove <span className="sr-only">{row.name}</span>
        </Button>
        <span className="flex flex-none gap-0.5">
          <MoveButton label={`Move “${row.name}” up`} disabled={first} onClick={moveUp}>
            ↑
          </MoveButton>
          <MoveButton label={`Move “${row.name}” down`} disabled={last} onClick={moveDown}>
            ↓
          </MoveButton>
        </span>
      </div>
      {renaming && canRename ? (
        <RenameForm
          name={row.name}
          usual={row.usual!}
          onSave={(title) => {
            onRename(title);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        (actions || renamed) && (
          <div className="flex items-center gap-1 pl-7">
            {actions}
            {renamed && (
              <Button variant="text" size="sm" onClick={() => onRename("")}>
                Use “{row.usual}”
              </Button>
            )}
          </div>
        )
      )}
    </li>
  );
}
