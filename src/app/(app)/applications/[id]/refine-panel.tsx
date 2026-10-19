"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import type { Tab } from "./tabs";

/** A message in the panel. */
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
};

/** The unit the next message is about, picked with "Ask AI". */
export type ChatTarget = { label: string; name: string };

const SUBTITLES: Record<Tab, string> = {
  resume: "Ask for changes to your tailored resume. I'll only use what's in your profile.",
  letter: "Ask for changes to your cover letter. I'll only use what's in your profile.",
  email: "Ask for changes to your email. I'll only use what's in your profile.",
  conversation: "Answers to employers are drafted right in the conversation.",
  posting: "Switch to the resume, cover letter or email to make changes.",
  notes: "Switch to the resume, cover letter or email to make changes.",
};

/**
 * "Refine with AI" (APP-7): the conversation about this application's
 * documents, with suggestions and a box to ask for a change. It sticks to
 * the side of the documents, and moves below them on narrow windows.
 */
export function RefinePanel({
  tab,
  messages,
  thinking,
  suggestions,
  target,
  onClearTarget,
  onSend,
  aiReady,
  focusRequest,
  children,
}: {
  tab: Tab;
  messages: ChatEntry[];
  /** A reply is on its way. */
  thinking: boolean;
  suggestions: string[];
  target: ChatTarget | null;
  onClearTarget: () => void;
  /** Resolves to whether the message was sent; the box keeps it otherwise. */
  onSend: (text: string) => Promise<boolean>;
  aiReady: boolean;
  /** Goes up when the box should take focus, e.g. after "Ask AI". */
  focusRequest: number;
  /** Under each message, by id: e.g. its Undo link (E8-6). */
  children?: (message: ChatEntry) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  const send = async (text: string) => {
    if (!text.trim() || thinking) return;
    setDraft("");
    if (!(await onSend(text.trim()))) setDraft(text);
  };

  return (
    <aside
      aria-labelledby="refine-heading"
      className="flex-[1_0_300px] border-t border-line bg-paper @min-[780px]:border-t-0 @min-[780px]:border-l"
    >
      <div className="flex h-[min(100dvh,680px)] flex-col @min-[780px]:h-full">
        <div className="flex flex-col gap-1 px-6 pt-[26px] pb-3.5">
          <h2 id="refine-heading" className="text-[15px] font-medium">
            Refine with AI
          </h2>
          <p className="text-meta leading-[1.45] text-muted">{SUBTITLES[tab]}</p>
        </div>

        {/* column-reverse keeps the newest message in view. Focusable, so it scrolls from the keyboard too (E11-3). */}
        <div role="log" aria-label="Conversation" tabIndex={0} className="flex min-h-0 flex-1 flex-col-reverse overflow-auto px-6">
          <div className="flex flex-col gap-3.5 pt-1.5 pb-4">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex flex-col gap-[5px]", message.role === "USER" ? "items-end" : "items-start")}>
                <Bubble message={message} />
                {children?.(message)}
              </div>
            ))}
            {thinking && <p className="pl-1 text-meta text-muted">Thinking…</p>}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line px-6 pt-3.5 pb-6">
          {!aiReady && tab !== "posting" && (
            <p className="text-meta text-muted">
              Refining needs an AI provider.{" "}
              <Link href="/settings?section=ai" className="font-medium text-ink underline underline-offset-2">
                Choose one in Settings
              </Link>
            </p>
          )}
          {aiReady && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  aria-disabled={thinking || undefined}
                  onClick={() => void send(suggestion)}
                  className="rounded-full border border-line-field bg-card px-[11px] py-1.5 text-label hover:border-line-strong aria-disabled:cursor-not-allowed aria-disabled:text-muted"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 rounded-card border border-line-input bg-input px-3 py-2.5 focus-within:border-primary">
            {target && (
              <div className="flex">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-track py-1 pr-1.5 pl-2.5 text-label">
                  About: {target.label}
                  <button
                    type="button"
                    aria-label={`Stop asking about the ${target.name}`}
                    onClick={onClearTarget}
                    className="rounded-full px-1 text-[13px] leading-none text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}
            <textarea
              ref={input}
              aria-label="Ask for a change"
              rows={2}
              value={draft}
              placeholder={target ? `What should change in the ${target.name}?` : "Ask for a change, e.g. “sound more confident”"}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line; not while an input method is composing.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              className="w-full resize-none bg-transparent text-sm leading-normal text-ink outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Enter to send</span>
              <Button size="sm" className="px-3.5 py-[7px]" aria-disabled={thinking || !draft.trim() || undefined} onClick={() => void send(draft)}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** One message: the user's in a dark bubble on the right, the AI's in a card on the left. */
function Bubble({ message }: { message: ChatEntry }) {
  if (message.role === "USER") {
    return (
      <div className="max-w-[92%] rounded-card border border-primary bg-primary px-3.5 py-[11px] text-[13.5px] leading-[1.55] text-pretty whitespace-pre-wrap text-on-primary">
        {message.targetUnit && <p className="mb-1 text-xs opacity-70">About: {message.targetUnit}</p>}
        {message.text}
      </div>
    );
  }
  const blocks = messageBlocks(message.text);
  const foot = message.opening && blocks.length > 1 && blocks.at(-1)?.kind === "text" ? blocks.pop() : null;
  return (
    <div className="flex max-w-[92%] flex-col gap-2 rounded-card border border-line-card bg-card px-3.5 py-[11px] text-[13.5px] leading-[1.55] text-pretty">
      {blocks.map((block, index) =>
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
      {foot?.kind === "text" && <p className="mt-0.5 text-label text-muted">{foot.text}</p>}
    </div>
  );
}

type Block = { kind: "text"; text: string } | { kind: "list"; lines: string[] };

/** A message's paragraphs; one whose lines all start with "- " is a list. */
export function messageBlocks(text: string): Block[] {
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
