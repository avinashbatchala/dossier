"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ApplicationStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";

import type { Tab } from "./tabs";

/** Change asks for a change to a document; Ask only answers (E30-10, AP5, public issue 132). */
export type ComposerMode = "change" | "ask";

/** The unit the next change is about, picked with "Ask AI". */
export type ComposerTarget = { label: string; name: string };

const CHANGE_PLACEHOLDERS: Partial<Record<Tab, string>> = {
  resume: "Ask for a change to the resume, e.g. “sound more confident”",
  letter: "Ask for a change to the letter, e.g. “more direct”",
  email: "Ask for a change to the email, e.g. “shorter”",
};

/** Questions to start from in Ask, by status. */
function askSuggestions(status: ApplicationStatus): string[] {
  if (status === "INTERVIEW") return ["What might they ask me?", "Which of my projects fit best?", "What should I ask them?"];
  if (status === "OFFER") return ["What should I check in the offer?", "How does this fit what I asked for?"];
  return ["What matters most to them?", "Which gaps should I address?", "What should I ask them?"];
}

/** The box's placeholder, by mode, tab and status. */
function composerPlaceholder(mode: ComposerMode, tab: Tab, status: ApplicationStatus, target: ComposerTarget | null): string {
  if (mode === "change") return target ? `What should change in the ${target.name}?` : (CHANGE_PLACEHOLDERS[tab] ?? "Ask for a change");
  if (status === "INTERVIEW") return "Ask for help getting ready…";
  if (status === "OFFER") return "Ask about the offer…";
  return "Ask about this job, or how you fit it";
}

/**
 * The composer (E30-10, design 3b): floating at the bottom of the canvas,
 * with suggestion chips, Change or Ask, and the box. Enter sends, and
 * Shift+Enter starts a new line. What's above it, the latest change and the
 * history, comes from the page (`above`).
 */
export function Composer({
  tab,
  status,
  mode,
  canChange,
  onModeChange,
  suggestions,
  thinking,
  target,
  onClearTarget,
  onSend,
  aiReady,
  focusRequest,
  above,
}: {
  tab: Tab;
  status: ApplicationStatus;
  mode: ComposerMode;
  /** There's a document on screen to change. */
  canChange: boolean;
  onModeChange: (mode: ComposerMode) => void;
  /** Changes to suggest, for the document on screen. */
  suggestions: string[];
  /** A reply is on its way. */
  thinking: boolean;
  target: ComposerTarget | null;
  onClearTarget: () => void;
  /** Resolves to whether the message was sent; the box keeps it otherwise. */
  onSend: (text: string) => Promise<boolean>;
  aiReady: boolean;
  /** Goes up when the box should take focus, e.g. after "Ask AI". */
  focusRequest: number;
  above?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const shown = canChange ? mode : "ask";
  const chips = shown === "ask" ? askSuggestions(status) : suggestions;

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  const send = async (text: string) => {
    if (!text.trim() || thinking) return;
    setDraft("");
    if (!(await onSend(text.trim()))) setDraft(text);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center px-4 @max-[780px]/page:fixed @max-[780px]/page:bottom-3">
      <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-2.5">
        {above}
        <section aria-label="Composer" className="flex flex-col gap-2.5 rounded-[16px] border border-line-strong bg-card py-3 pr-3 pl-4 shadow-menu">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {!aiReady ? (
                <p className="py-1 text-meta text-muted">
                  This needs an AI provider.{" "}
                  <Link href="/settings?section=ai" className="font-medium text-ink underline underline-offset-2">
                    Choose one in Settings
                  </Link>
                </p>
              ) : (
                chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    aria-disabled={thinking || undefined}
                    onClick={() => void send(chip)}
                    className="rounded-full border border-line-field px-2.5 py-[5px] text-[12.5px] text-document hover:border-line-strong hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:text-muted"
                  >
                    {chip}
                  </button>
                ))
              )}
            </div>
            <SegmentedControl
              size="sm"
              aria-label="What the box does"
              value={shown}
              onValueChange={onModeChange}
              options={[
                { value: "change", label: "Change", disabled: !canChange },
                { value: "ask", label: "Ask" },
              ]}
            />
          </div>
          {target && shown === "change" && (
            <div className="flex">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-track py-1 pr-1.5 pl-2.5 text-label">
                About: {target.label}
                <button type="button" aria-label={`Stop asking about the ${target.name}`} onClick={onClearTarget} className="rounded-full px-1 text-[13px] leading-none text-muted hover:text-ink">
                  ×
                </button>
              </span>
            </div>
          )}
          <div className="flex items-end gap-3">
            <Sparkles size={16} aria-hidden="true" className="mb-2.5 flex-none text-muted" />
            <textarea
              ref={input}
              aria-label={shown === "ask" ? "Ask a question" : "Ask for a change"}
              rows={1}
              value={draft}
              placeholder={composerPlaceholder(shown, tab, status, target)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line; not while an input method is composing.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              className={cn(
                "max-h-40 min-h-9 w-full flex-1 resize-none bg-transparent py-2 text-[14.5px] leading-normal text-ink outline-none [field-sizing:content] placeholder:text-muted",
              )}
            />
            <Button size="sm" className="flex-none px-3.5 py-[7px]" aria-disabled={thinking || !draft.trim() || undefined} onClick={() => void send(draft)}>
              Send
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
