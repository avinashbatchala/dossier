import type { ReactNode } from "react";

import type { Instruction } from "@/lib/setup/instructions";

/** Text with **bold** for what's on the screen. */
function withBold(text: string): ReactNode[] {
  return text.split("**").map((part, index) => (index % 2 === 1 ? <strong key={index} className="font-medium text-ink">{part}</strong> : part));
}

/** The guide's numbered steps, each with the page to do it on, opening in a new tab. */
export function InstructionList({ steps, label }: { steps: readonly Instruction[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-3.5">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden="true" className="grid size-6 flex-none place-items-center rounded-full bg-paper text-xs font-medium text-ink tabular-nums">
            {index + 1}
          </span>
          <span className="flex flex-col gap-1 pt-0.5 text-sm leading-relaxed text-pretty text-muted">
            <span>{withBold(step.text)}</span>
            {step.link && (
              <a href={step.link.href} target="_blank" rel="noopener noreferrer" className="self-start font-medium text-ink underline underline-offset-2">
                Open {step.link.label} <span aria-hidden="true">↗</span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
