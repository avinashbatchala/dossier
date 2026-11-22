"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { cn } from "@/lib/cn";

import { hideDailyNote, writeDailyNoteAction } from "./actions";

/** Today's note as the server has it; null when it isn't written yet. */
export type DailyNoteValue = { text: string; rewritesLeft: number } | null;

const iconButton =
  "grid size-[30px] place-items-center rounded-control text-muted hover:bg-hover hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent";

/**
 * The daily note (E28-6), across the top of the dashboard: a short, kind
 * message in the hand-written face. Today's first one is written after the
 * page has loaded, so the dashboard never waits for it. ↻ asks for another
 * (three a day), × hides it until midnight.
 */
export function DailyNote({ initial }: { initial: DailyNoteValue }) {
  const [note, setNote] = useState(initial);
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const asked = useRef(false);

  // Today's first note, once, after the page is in.
  useEffect(() => {
    if (initial || asked.current) return;
    asked.current = true;
    void writeDailyNoteAction({ another: false }).then((result) => {
      if (result.ok && result.data && result.data !== "hidden") setNote(result.data);
    });
  }, [initial]);

  if (hidden) return null;

  const another = () =>
    startTransition(async () => {
      const result = toastResult(await writeDailyNoteAction({ another: true }));
      if (result.ok && result.data && result.data !== "hidden") setNote(result.data);
    });
  const hide = () => {
    setHidden(true);
    startTransition(async () => {
      if (!toastResult(await hideDailyNote({})).ok) setHidden(false);
    });
  };
  const noneLeft = note?.rewritesLeft === 0;

  return (
    <section aria-label="Today's note" aria-busy={!note || pending || undefined} className="-mx-12 flex items-start gap-6 border-b border-line px-12 pb-6">
      <figure className="flex min-w-0 flex-1 flex-col gap-2">
        <blockquote
          className={cn(
            "origin-left -rotate-[0.4deg] font-hand text-[30px] leading-[1.3] text-pretty text-note motion-safe:transition-opacity",
            (!note || pending) && "opacity-50",
          )}
        >
          {note ? <Written key={note.text} text={note.text} /> : "…"}
        </blockquote>
      </figure>
      <div className="flex shrink-0 gap-1 pt-1">
        <button
          type="button"
          onClick={() => !noneLeft && note && !pending && another()}
          aria-disabled={!note || noneLeft || pending || undefined}
          aria-label="Another one"
          title={noneLeft ? "That's today's last one" : "Another one"}
          className={iconButton}
        >
          <RefreshCw size={15} aria-hidden="true" className={cn(pending && "motion-safe:animate-spin")} />
        </button>
        <button type="button" onClick={hide} aria-label="Hide for today" title="Hide for today" className={iconButton}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

/** About how long a note takes to write itself, however long it is. */
const WRITING_MS = 1100;

/**
 * Today's note as if written (#523): word after word fades in, about a
 * second in all, each time a new note comes. Every word is in the page from
 * the start, so screen readers read it whole; with reduced motion it's
 * simply there.
 */
function Written({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  const words = parts.filter((part) => part.trim()).length;
  const step = Math.min(90, WRITING_MS / Math.max(words, 1));
  const delays = parts.map((part, index) => (part.trim() ? parts.slice(0, index).filter((before) => before.trim()).length * step : 0));
  return parts.map((part, index) =>
    part.trim() ? (
      <span key={index} className="motion-safe:animate-write" style={{ animationDelay: `${Math.round(delays[index])}ms` }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}
