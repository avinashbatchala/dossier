"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { WRITE_APPLICATION_STEPS } from "@/lib/jobs/application-steps";
import type { DocumentsToWrite } from "@/lib/settings";

// New application writing an application's documents on the server (E31-5,
// design 6a3): the step strip above the document, a page that fills in
// where the document will be, and a note that it keeps going without you.

/** The steps for what's being written: one document skips the other's. */
export function writingSteps(write: DocumentsToWrite): readonly string[] {
  return WRITE_APPLICATION_STEPS.filter((step) => !(write === "resume" && step === WRITE_APPLICATION_STEPS[3]) && !(write === "letter" && step === WRITE_APPLICATION_STEPS[2]));
}

const HEADINGS: Record<string, string> = {
  [WRITE_APPLICATION_STEPS[0]]: "Reading your profile",
  [WRITE_APPLICATION_STEPS[1]]: "Choosing what fits",
  [WRITE_APPLICATION_STEPS[2]]: "Writing your resume",
  [WRITE_APPLICATION_STEPS[3]]: "Writing your letter",
  [WRITE_APPLICATION_STEPS[4]]: "Checking every line",
};

/** "Writing your resume · Step 3 of 5", and each step as a bar. */
export function WritingStrip({ steps, step }: { steps: readonly string[]; step: string | null }) {
  const current = Math.max(0, steps.indexOf(step ?? ""));
  return (
    <div role="status" aria-label="Writing" className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[12px] border border-line-card bg-card px-5 py-3.5">
      <div className="flex flex-col gap-0.5">
        <p className="font-serif text-[20px] leading-tight text-ink">{HEADINGS[steps[current]] ?? "Starting"}</p>
        <p className="text-meta text-muted">
          Step {current + 1} of {steps.length}
        </p>
      </div>
      <ol className="grid min-w-[min(100%,420px)] flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((label, index) => (
          <li key={label} aria-current={index === current ? "step" : undefined} className="flex flex-col gap-1.5">
            <span aria-hidden="true" className="h-[3px] overflow-hidden rounded-full bg-track">
              <span className={cn("block h-full rounded-full bg-primary", index < current ? "w-full" : index === current ? "w-1/2 motion-safe:animate-pulse" : "w-0")} />
            </span>
            <span className={cn("text-[11.5px] leading-tight", index === current ? "font-medium text-ink" : index < current ? "text-ink" : "text-muted")}>
              {label}
              {index < current && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const BARS = ["92%", "78%", "44%", "88%", "70%", "60%"];

/** Where a document will be, until it's written: its page, with the name on it and lines to come. */
export function WritingPage({ strip, name, waiting }: { strip: ReactNode; name: string; waiting: string }) {
  return (
    <div className="flex min-w-0 flex-[999_1_480px] flex-col items-center overflow-auto bg-canvas px-10 pt-10 pb-[var(--composer-space,4rem)]">
      <div className="flex w-full max-w-[820px] flex-col gap-4">
        {strip}
        <div className="flex flex-col gap-6 bg-white px-[9%] py-[7%] text-[#1f1f1f] shadow-page">
          <p className="font-serif text-[34px] leading-none">{name}</p>
          <p className="text-meta text-[#6b6b6b]">{waiting}</p>
          <div aria-hidden="true" className="flex flex-col gap-3">
            {BARS.map((width, index) => (
              <span key={index} className="h-2 rounded-full bg-black/8 motion-safe:animate-pulse" style={{ width }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "You can leave this page…" · Stop, floating over the canvas. */
export function WritingNote({ notifies, stopping, onStop }: { notifies: boolean; stopping: boolean; onStop: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <p className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line-card bg-card px-4 py-2.5 text-[13.5px] text-muted shadow-menu">
        <span>
          You can leave this page. It shows as a Draft on the board{notifies ? ", and I'll let you know when it's done." : ", and keeps writing."}
        </span>
        <button type="button" aria-disabled={stopping || undefined} onClick={() => !stopping && onStop()} className="font-medium text-ink underline underline-offset-[3px]">
          {stopping ? "Stopping…" : "Stop"}
        </button>
      </p>
    </div>
  );
}
