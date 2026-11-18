"use client";

import { useState } from "react";

import { formatShortDate } from "@/lib/dates";
import type { WeekActivity } from "@/lib/dashboard";

// The weekly activity chart (E9-8): applications started and sent per week.
// Sent is the series that matters, in the Sent status color; started is the
// context, in gray (checked for contrast on the card and for color-blind
// readers). Thin columns with a 4px rounded top, a legend, a tooltip on
// hover, and the numbers as a table for everyone else.

const SERIES = [
  { key: "created", label: "Started", swatch: "bg-muted" },
  { key: "sent", label: "Sent", swatch: "bg-status-sent" },
] as const;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function ActivityChart({ weeks }: { weeks: WeekActivity[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const started = weeks.reduce((sum, week) => sum + week.created, 0);
  const sent = weeks.reduce((sum, week) => sum + week.sent, 0);
  const max = Math.max(1, ...weeks.flatMap((week) => [week.created, week.sent]));
  // At most six dates under the chart: the first week and every nth after it.
  const every = Math.max(1, Math.ceil(weeks.length / 6));

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-5 rounded-panel border border-line-card bg-card p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="activity-heading" className="font-serif text-section">
            Week by week
          </h2>
          <p className="text-control text-muted">
            {weeks.length === 0 ? "Nothing to show yet." : `You started ${plural(started, "application", "applications")} and sent ${sent} in this period.`}
          </p>
        </div>
        {weeks.length > 0 && (
          <ul aria-label="Legend" className="flex gap-4 text-meta text-muted">
            {SERIES.map((series) => (
              <li key={series.key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2.5 rounded-[2px] ${series.swatch}`} />
                {series.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {weeks.length > 0 && (
        <>
          {/* The picture; the table below has the same numbers for screen readers and keyboards. */}
          <div aria-hidden="true" className="flex gap-3">
            <div className="flex h-[140px] flex-col justify-between text-right text-label text-muted tabular-nums">
              <span className="-mt-2">{max}</span>
              <span className="-mb-2">0</span>
            </div>
            <div className="relative flex min-w-0 flex-1 flex-col gap-2">
              <div className="relative flex h-[140px] items-end border-b border-line">
                <span className="absolute inset-x-0 top-0 border-t border-line" />
                {weeks.map((week, index) => (
                  <div
                    key={week.start.toISOString()}
                    onPointerEnter={() => setHovered(index)}
                    onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
                    className="relative flex h-full flex-1 items-end justify-center gap-[2px] px-[1px]"
                  >
                    {SERIES.map((series) => (
                      <span
                        key={series.key}
                        className={`w-full max-w-[10px] rounded-t-[4px] ${series.swatch} ${hovered !== null && hovered !== index ? "opacity-50" : ""}`}
                        style={{ height: `${(week[series.key] / max) * 100}%`, minHeight: week[series.key] > 0 ? 2 : 0 }}
                      />
                    ))}
                    {hovered === index && (
                      <span
                        className={`pointer-events-none absolute top-1 z-10 rounded-card border border-line-popover bg-card px-3 py-2 text-meta whitespace-nowrap shadow-menu ${
                          // Kept inside the chart: anchored to the side near either edge.
                          index < 2 ? "left-0" : index > weeks.length - 3 ? "right-0" : "left-1/2 -translate-x-1/2"
                        }`}
                      >
                        <span className="block text-muted">Week of {formatShortDate(week.start)}</span>
                        <span className="block">
                          <strong className="font-medium text-ink">{week.created}</strong> started ·{" "}
                          <strong className="font-medium text-ink">{week.sent}</strong> sent
                        </span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex text-label text-muted">
                {weeks.map((week, index) => (
                  <span key={week.start.toISOString()} className="flex-1 overflow-visible whitespace-nowrap">
                    {index % every === 0 ? formatShortDate(week.start) : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <details className="text-meta text-muted">
            <summary className="w-fit cursor-pointer hover:text-ink">Show the numbers</summary>
            <table className="mt-3 w-full max-w-[420px] text-left tabular-nums">
              <caption className="sr-only">Applications started and sent per week</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 font-medium text-ink">
                    Week of
                  </th>
                  <th scope="col" className="py-1 text-right font-medium text-ink">
                    Started
                  </th>
                  <th scope="col" className="py-1 text-right font-medium text-ink">
                    Sent
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.start.toISOString()} className="border-t border-line">
                    <th scope="row" className="py-1 font-normal">
                      {formatShortDate(week.start)}
                    </th>
                    <td className="py-1 text-right text-ink">{week.created}</td>
                    <td className="py-1 text-right text-ink">{week.sent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
