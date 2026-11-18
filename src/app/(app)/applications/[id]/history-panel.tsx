"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import type { HistoryEntry } from "@/lib/application-history";
import { formatShortDate } from "@/lib/dates";
import { DOCUMENT_LABELS } from "@/lib/file-name";

import { MessageText } from "./latest-reply";

/** "29 Sep, 14:05", in the browser's time zone, dated as elsewhere in the app. */
function historyTime(iso: string): string {
  const date = new Date(iso);
  return `${formatShortDate(date)}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** "Resume v4 · Cover letter v3" */
const versionsLine = (entry: Extract<HistoryEntry, { kind: "change" }>) =>
  entry.versions.map((version) => `${DOCUMENT_LABELS[version.document]} v${version.number}`).join(" · ");

/** Undo on the latest change brings back what was before it, in each document it changed; null when there was nothing before. */
export function undoIds(entry: HistoryEntry | undefined): string[] | null {
  if (entry?.kind !== "change") return null;
  const ids = entry.versions.map((version) => version.previousId);
  return ids.every((id): id is string => id !== null) ? ids : null;
}

/**
 * The history (E30-11, design 4f): every change across the documents, and
 * the questions answered in Ask, newest first, above the composer. Undo on
 * the latest change; Go back to this on older ones, which makes a new
 * version. Esc closes it.
 */
export function HistoryPanel({
  entries,
  busy,
  onGoBack,
  onUndo,
  onClose,
}: {
  entries: HistoryEntry[];
  /** A going back is on its way. */
  busy: boolean;
  /** Brings these versions back, one per document. */
  onGoBack: (versionIds: string[]) => void;
  /** Undo on the latest change. */
  onUndo: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const latestChange = entries.find((entry) => entry.kind === "change");

  useEffect(() => {
    panel.current?.focus();
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-labelledby="history-heading"
      className="flex max-h-[min(52vh,520px)] flex-col overflow-hidden rounded-[14px] border border-line-card bg-card shadow-menu focus:outline-none motion-safe:animate-toast-in"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 pr-2 pl-4">
        <h2 id="history-heading" className="text-[13.5px] font-medium">
          History
        </h2>
        <button type="button" aria-label="Close the history" onClick={onClose} className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-meta text-muted">Nothing yet. Each change the AI makes, and each answer, shows here.</p>
      ) : (
        <ol aria-label="Changes" className="flex flex-col overflow-auto">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13.5px] leading-[1.5]">
                <p className="text-[12px] text-muted tabular-nums">
                  {entry.kind === "change" ? `${versionsLine(entry)} · ${entry.why}` : "Asked"} · {historyTime(entry.at)}
                </p>
                {entry.kind === "change" ? (
                  <p className="break-words">{entry.text}</p>
                ) : (
                  <>
                    <p className="font-medium break-words">{entry.question}</p>
                    <div className="flex flex-col gap-1.5 text-document">
                      <MessageText text={entry.text} />
                    </div>
                  </>
                )}
              </div>
              {entry.kind === "change" &&
                (entry === latestChange ? (
                  (undoIds(entry) || entry.messageId) && (
                    <Button variant="secondary" size="sm" className="flex-none" aria-disabled={busy || undefined} onClick={() => !busy && onUndo()}>
                      Undo
                    </Button>
                  )
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-none"
                    aria-disabled={busy || undefined}
                    onClick={() => !busy && onGoBack(entry.versions.map((version) => version.id))}
                  >
                    Go back to this <span className="sr-only">version, {historyTime(entry.at)}</span>
                  </Button>
                ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
