"use client";

import type { Trimmed } from "@/lib/application-data";

/** "Studio Brik role" or "1 bullet from the Fieldnote role" */
function describe(item: Trimmed[number]): string {
  if (item.kind === "unit") return item.unit.label;
  const count = item.lines.length;
  return `${count} ${count === 1 ? "bullet" : "bullets"} from the ${item.label}`;
}

/** What was left out of the resume to fit its page limit (E10-10), each with "Put back". */
export function TrimmedNotice({ items, onPutBack }: { items: Trimmed; onPutBack: (index: number) => void }) {
  return (
    <div role="note" className="flex flex-col gap-1.5 rounded-card border border-line-card bg-card px-4 py-3 text-meta">
      <p className="text-muted">Left out to fit the page limit:</p>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <span className="text-ink">{describe(item)}</span>
            <button
              type="button"
              aria-label={`Put back the ${describe(item)}`.replace("the 1 bullet", "1 bullet")}
              onClick={() => onPutBack(index)}
              className="text-muted underline underline-offset-2 hover:text-ink"
            >
              Put back
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
