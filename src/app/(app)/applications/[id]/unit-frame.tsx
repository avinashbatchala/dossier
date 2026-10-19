"use client";

import { Popover } from "radix-ui";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { Unit } from "@/lib/application-data";
import { cn } from "@/lib/cn";
import { isRoleUnit } from "@/lib/unit-text";

import styles from "./unit-frame.module.css";

export type UnitFrameProps = {
  id: string;
  /** The class the document gives this unit, e.g. an entry's spacing. */
  className?: string;
  /** A role's or degree's title line, which stays while the text is edited. */
  head?: ReactNode;
  children: ReactNode;
  unit: Unit;
  editing: boolean;
  /** Saving an edit; the editor stays until it's done. */
  saving: boolean;
  /** The AI is rewriting it (E8-4). */
  busy: boolean;
  flashing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onRegenerate?: () => void;
  onAskAi?: () => void;
};

const toolButton =
  "rounded-[6px] px-[9px] py-[5px] text-on-inverse hover:bg-white/14 focus-visible:outline-on-inverse focus-visible:-outline-offset-2";

/**
 * One unit of a tailored document in the preview (APP-5, APP-6). Hovering it
 * or giving it keyboard focus highlights it and shows its toolbar: Edit,
 * Regenerate and Ask AI. Edit swaps in a text box.
 */
export function UnitFrame({
  id,
  className,
  head,
  children,
  unit,
  editing,
  saving,
  busy,
  flashing,
  onEdit,
  onCancel,
  onSave,
  onRegenerate,
  onAskAi,
}: UnitFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(editing);

  // Leaving the editor puts focus back on the unit, not the top of the page.
  useLayoutEffect(() => {
    if (wasEditing.current && !editing && (!document.activeElement || document.activeElement === document.body)) {
      frame.current?.focus();
    }
    wasEditing.current = editing;
  }, [editing]);

  const flagged = !editing && unit.unverified && unit.unverified.length > 0;

  return (
    <div
      ref={frame}
      className={cn(className, styles.frame, flashing && styles.flash, busy && styles.busy, editing && styles.editing)}
      data-unit={id}
      role="group"
      aria-label={unit.label}
      aria-busy={busy || undefined}
      tabIndex={editing ? -1 : 0}
    >
      <div className={styles.content}>
        {head}
        {!editing && children}
      </div>
      {editing && <UnitEditor unit={unit} saving={saving} onCancel={onCancel} onSave={onSave} />}
      {flagged && <CheckThis facts={unit.unverified!} />}
      {busy ? (
        <span className={cn(styles.status, "rounded-[6px] border border-line-popover bg-card px-2 py-1 font-sans text-[11.5px] leading-[1.2] text-muted")}>
          Rewriting…
        </span>
      ) : (
        !editing && (
          <div
            className={cn(
              styles.toolbar,
              "gap-0.5 rounded-control bg-inverse p-[3px] font-sans text-xs leading-[1.2] font-medium whitespace-nowrap shadow-toolbar",
            )}
          >
            <button type="button" className={toolButton} onClick={onEdit}>
              Edit
            </button>
            {onRegenerate && (
              <button type="button" className={toolButton} onClick={onRegenerate}>
                Regenerate
              </button>
            )}
            {onAskAi && (
              <button type="button" className={toolButton} onClick={onAskAi}>
                Ask AI
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}

/** The text box that replaces a unit while it's edited: a role's bullets one per line. */
function UnitEditor({
  unit,
  saving,
  onCancel,
  onSave,
}: {
  unit: Unit;
  saving: boolean;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [value, setValue] = useState(unit.text);
  // Grows with the text where the browser can (field-sizing); elsewhere, about a row per 70 characters.
  const rows = Math.max(3, value.split("\n").reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 70)), 1));
  return (
    <div className={cn(styles.editor, "mt-1 flex flex-col gap-2 font-sans")} dir="auto">
      <textarea
        aria-label={`Edit ${unit.label}`}
        aria-describedby={isRoleUnit(unit.id) ? `${unit.id}-hint` : undefined}
        // Opened on request, so the text box takes focus.
        autoFocus
        value={value}
        rows={rows}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave(value);
          }
        }}
        className="max-h-[60vh] w-full resize-y rounded-control border border-primary bg-input px-3 py-2.5 text-[13.5px] leading-[1.55] text-ink [field-sizing:content] focus-visible:outline-offset-0 disabled:opacity-60"
      />
      <div className="flex items-center justify-end gap-1.5">
        {isRoleUnit(unit.id) && (
          <span id={`${unit.id}-hint`} className="mr-auto text-xs text-muted">
            One bullet per line
          </span>
        )}
        <Button variant="secondary" size="sm" className="bg-input" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(value)} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** The fact guard's hint (E6-6): details the profile and the posting don't back. */
function CheckThis({ facts }: { facts: string[] }) {
  const quoted = facts.map((fact) => `“${fact}”`).join(", ");
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`Check this: ${quoted}`}
        title="Check this"
        className={cn(
          styles.check,
          "grid size-4 place-items-center rounded-full border border-warning-line bg-warning-surface font-sans text-[11px] leading-none font-bold text-warning",
        )}
      >
        !
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-30 flex max-w-[280px] flex-col gap-1 rounded-card border border-line-popover bg-card px-3.5 py-3 text-meta shadow-menu"
        >
          <p className="font-medium">Check this</p>
          <p className="text-muted">
            I couldn&apos;t find {quoted} in your profile or the posting. If {facts.length === 1 ? "it isn't" : "they aren't"}{" "}
            right, edit this part before you send it.
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
