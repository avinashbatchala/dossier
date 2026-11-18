"use client";

import { Popover } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { Unit } from "@/lib/application-data";
import { lineText } from "@/lib/changed-lines";
import { cn } from "@/lib/cn";
import { isBulletUnit } from "@/lib/unit-text";

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
  /**
   * A change just landed here (E30-12): the page scrolls to it, marks the
   * changed lines (all of it when `lines` is null) for about 4 s, and offers
   * Keep and Undo.
   */
  landing?: { lines: string[] | null; onKeep: () => void; onUndo: () => void } | null;
  /** The lines that cover the requirement picked in the Fit column (E30-4), highlighted with `flash`. */
  highlight?: readonly string[] | null;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (text: string) => void;
  onRegenerate?: () => void;
  onAskAi?: () => void;
  /** Takes it off a tailored resume (#217). */
  onLeaveOut?: () => void;
};

const toolButton =
  "rounded-[6px] px-[9px] py-[5px] text-on-inverse hover:bg-white/14 focus-visible:outline-on-inverse focus-visible:-outline-offset-2";

/** How long a change's mark stays (E30-12). */
const LANDING_MS = 4_000;

/**
 * One unit of a tailored document in the preview (APP-5, APP-6). Hovering it
 * or giving it keyboard focus highlights it and shows its toolbar: Edit,
 * Regenerate, Ask AI and, on a resume, Leave out. Edit swaps in a text box.
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
  landing = null,
  highlight = null,
  onEdit,
  onCancel,
  onSave,
  onRegenerate,
  onAskAi,
  onLeaveOut,
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
  const landed = landing !== null && !editing;
  const lines = landing?.lines ?? null;
  const linesKey = lines?.join("\n") ?? "";

  // The lines that cover the picked requirement (E30-4); the whole part when none of its lines match.
  const highlightKey = highlight?.join("\n") ?? "";
  useEffect(() => {
    const element = frame.current;
    if (!element || !highlightKey) return;
    const wanted = new Set(highlightKey.split("\n"));
    const marked = [...element.querySelectorAll("li, p")].filter((line) => wanted.has(lineText(line.textContent ?? "")));
    marked.forEach((line) => line.setAttribute("data-highlight", ""));
    // No line of it matches, e.g. a summary drawn as one block: the whole part.
    // An attribute React doesn't own, so a re-render keeps it.
    if (marked.length === 0) element.setAttribute("data-highlight-all", "");
    return () => {
      marked.forEach((line) => line.removeAttribute("data-highlight"));
      element.removeAttribute("data-highlight-all");
    };
  }, [highlightKey]);

  // Where the change landed: into view, and its lines marked for a moment.
  useEffect(() => {
    const element = frame.current;
    if (!landed || !element) return;
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView?.({ block: "center", behavior: smooth ? "smooth" : "auto" });
    const wanted = new Set(linesKey ? linesKey.split("\n") : []);
    const marked = wanted.size > 0 ? [...element.querySelectorAll("li, p")].filter((line) => wanted.has(lineText(line.textContent ?? ""))) : [];
    marked.forEach((line) => line.setAttribute("data-change", ""));
    const timer = setTimeout(() => marked.forEach((line) => line.removeAttribute("data-change")), LANDING_MS);
    return () => {
      clearTimeout(timer);
      marked.forEach((line) => line.removeAttribute("data-change"));
    };
  }, [landed, linesKey]);

  return (
    <div
      ref={frame}
      className={cn(
        className,
        styles.frame,
        flashing && !landed && styles.flash,
        landed && !lines && styles.landing,
        busy && styles.busy,
        editing && styles.editing,
      )}
      data-highlighted={highlightKey ? "" : undefined}
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
      {landed && !busy ? (
        <div role="status" className={cn(styles.status, "flex items-center gap-0.5 rounded-control bg-inverse p-[3px] pl-2.5 font-sans text-xs leading-[1.2] font-medium whitespace-nowrap text-on-inverse shadow-toolbar")}>
          <span className="pr-1.5">Changed just now</span>
          <button type="button" className={toolButton} onClick={landing!.onKeep}>
            Keep
          </button>
          <button type="button" className={toolButton} onClick={landing!.onUndo}>
            Undo
          </button>
        </div>
      ) : busy ? (
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
            {onLeaveOut && (
              <button type="button" className={toolButton} onClick={onLeaveOut}>
                Leave out
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
        aria-describedby={isBulletUnit(unit.id) ? `${unit.id}-hint` : undefined}
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
        className="max-h-[calc(60vh/var(--preview-scale,1))] w-full resize-y rounded-control border border-primary bg-input px-3 py-2.5 text-control leading-[1.55] text-ink [field-sizing:content] focus-visible:outline-offset-0 disabled:opacity-60"
      />
      <div className="flex items-center justify-end gap-1.5">
        {isBulletUnit(unit.id) && (
          <span id={`${unit.id}-hint`} className="mr-auto text-xs text-muted">
            One bullet per line
          </span>
        )}
        <Button variant="secondary" size="sm" className="min-h-[calc(var(--px)*30)] bg-input" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" className="min-h-[calc(var(--px)*30)]" onClick={() => onSave(value)} disabled={saving}>
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
