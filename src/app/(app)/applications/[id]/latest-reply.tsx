"use client";

import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

/** A message of an application's chat (E8-5), as the page has it. */
export type ChatEntry = {
  id: string;
  role: "USER" | "AI";
  text: string;
  /** The unit a message was about ("About: Summary"). */
  targetUnit: string | null;
  /** The opening "Here's what I tailored" message (E7-6), whose last paragraph is a footnote. */
  opening: boolean;
  /** A reply that changed units, which can be undone (E8-6). */
  canUndo: boolean;
  undone: boolean;
  /** When it was written, ISO; missing for a message being sent. */
  at?: string;
};

type Block = { kind: "text"; text: string } | { kind: "list"; lines: string[] };

/** A message's paragraphs; one whose lines all start with "- " is a list. */
function messageBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph): Block => {
      const lines = paragraph.split("\n");
      return lines.every((line) => line.startsWith("- "))
        ? { kind: "list", lines: lines.map((line) => line.slice(2).trim()) }
        : { kind: "text", text: paragraph };
    });
}

/** A message's text as paragraphs and lists. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {messageBlocks(text).map((block, index) =>
        block.kind === "list" ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-[1.1em]">
            {block.lines.map((line, item) => (
              <li key={item}>{line}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-wrap">
            {block.text}
          </p>
        ),
      )}
    </>
  );
}

const card = "rounded-[12px] border border-line-card bg-card shadow-menu";

/**
 * What's above the composer (E30-10, E30-11, design 3b): only the latest
 * thing. A change reads "✓ Moved payments up · Undo · 4 earlier ▴"; an
 * answer, or a change the AI declined, shows in full until hidden.
 * `earlier` opens the history.
 */
export function LatestReply({
  change,
  message,
  thinking,
  undoing,
  onUndo,
  onHide,
  earlier,
}: {
  /** The latest change, when it's newer than the latest reply. */
  change: { text: string; canUndo: boolean } | null;
  /** The latest reply that changed nothing, or null when there's none to show. */
  message: ChatEntry | null;
  thinking: boolean;
  /** Its Undo is on its way. */
  undoing: boolean;
  onUndo: () => void;
  onHide: () => void;
  /** "4 earlier ▴". */
  earlier?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div role="log" aria-label="Conversation" className="flex flex-col items-start gap-2">
      {thinking ? (
        <p className={`${card} px-3.5 py-2.5 text-[13.5px] text-muted`}>Thinking…</p>
      ) : change ? (
        <div className={`${card} flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-[13.5px]`}>
          <span aria-hidden="true" className="text-success">
            ✓
          </span>
          <span className="min-w-0">{change.text}</span>
          {change.canUndo && (
            <button type="button" aria-disabled={undoing || undefined} onClick={() => !undoing && onUndo()} className="text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline aria-disabled:no-underline">
              {undoing ? "Undoing…" : "Undo"}
            </button>
          )}
          {earlier}
        </div>
      ) : message && message.opening && !expanded ? (
        // The opening "Here's what I tailored" is long: one line, so it doesn't cover the document.
        <div className={`${card} flex max-w-full items-center gap-x-3 px-3.5 py-2.5 text-[13.5px]`}>
          <span className="min-w-0 truncate">{message.text.split("\n")[0]}</span>
          <button type="button" onClick={() => setExpanded(true)} className="flex-none text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Show
          </button>
          {earlier}
        </div>
      ) : message ? (
        <div className={`${card} relative flex max-h-56 w-full flex-col gap-2 overflow-auto py-3 pr-10 pl-4 text-[13.5px] leading-[1.55] text-pretty`}>
          <MessageText text={message.text} />
          {earlier && <div className="flex">{earlier}</div>}
          <button type="button" aria-label="Hide this answer" onClick={onHide} className="absolute top-2 right-2 grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        earlier && <div className={`${card} px-3.5 py-2`}>{earlier}</div>
      )}
    </div>
  );
}
