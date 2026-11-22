"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent } from "react";

import type { ApplicationStatus, FunnelStage } from "@/generated/prisma/enums";
import { statusHref } from "@/lib/applications-list";
import { FUNNEL_OUTCOMES, type FunnelOutcome, type FunnelStep } from "@/lib/dashboard";
import { statusInfo } from "@/lib/status";

// "Your funnel" as a Sankey diagram (decided 16 October 2026). Each stage is
// a node as tall as the applications that reached it, and they flow on to
// the next stage along the top. Those that went no further branch off below
// into one node per outcome: still open, rejected, declined or archived.
// Stage names and counts are text above the picture; the picture itself is
// hidden from screen readers, and the table under it has every number. Each
// stage and each end node links to its applications (E28-2).

/** The picture's width in SVG units. It stretches to the card, so x is a share of the width; y is in pixels. */
const WIDTH = 1000;
const NODE = 12;
/** Pixels between a stage's onward flow and the nodes for the ones that stopped there. */
const DROP = 20;
/** The room an outcome's label needs, however few it holds, and the space between two. */
const SLOT = 20;
const SPACE = 4;
/** The tallest Sent gets, and the most one application adds to a node: about 26px each (E28-2). */
const MAX_HEIGHT = 260;
const MAX_UNIT = 26;

const OUTCOME_COLORS: Record<Exclude<FunnelOutcome, "open">, string> = {
  rejected: "var(--color-status-rejected)",
  declined: "var(--color-status-declined)",
  archived: "var(--color-status-draft)",
};

const stageLabel = (stage: FunnelStage) => statusInfo(stage as ApplicationStatus).label;
const stageColor = (stage: FunnelStage) => statusInfo(stage as ApplicationStatus).color;
const outcomeColor = (stage: FunnelStage, outcome: FunnelOutcome) => (outcome === "open" ? stageColor(stage) : OUTCOME_COLORS[outcome]);

/** What the chart calls the ones still open at a stage, and how the tooltip says it. */
const OPEN: Partial<Record<FunnelStage, { short: string; long: (count: number) => string }>> = {
  SENT: { short: "waiting", long: () => "waiting to hear back" },
  SCREENING: { short: "in screening", long: () => "still in screening" },
  INTERVIEW: { short: "interviewing", long: () => "still interviewing" },
  OFFER: { short: "deciding", long: (count) => (count === 1 ? "offer you're deciding on" : "offers you're deciding on") },
};
/** Where a closed application stopped, for the tooltip: "1 rejected at screening". */
const AT: Partial<Record<FunnelStage, string>> = {
  SENT: "after sending",
  SCREENING: "at screening",
  INTERVIEW: "after interviewing",
  OFFER: "at the offer",
};

/** The applications at a stage now, or that ended a way: that status's list (E27-4, LB1). */
const stageHref = (stage: FunnelStage) => statusHref(stage as ApplicationStatus);
function outcomeHref(stage: FunnelStage, outcome: FunnelOutcome): string {
  if (outcome === "open") return stageHref(stage);
  if (outcome === "archived") return "/applications?archived=1&view=list";
  return statusHref(outcome === "rejected" ? "REJECTED" : "DECLINED");
}

const outcomeLabel = (stage: FunnelStage, outcome: FunnelOutcome) => (outcome === "open" ? (OPEN[stage]?.short ?? "open") : outcome);
const outcomeSentence = (stage: FunnelStage, outcome: FunnelOutcome, count: number) =>
  outcome === "open" ? (OPEN[stage]?.long(count) ?? "still open") : `${outcome} ${AT[stage] ?? ""}`.trim();

/** A band from one node's right edge to another's left edge, `size` pixels thick, as an SVG path. */
function band(x0: number, y0: number, x1: number, y1: number, size: number): string {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1} V${y1 + size} C${mid},${y1 + size} ${mid},${y0 + size} ${x0},${y0 + size} Z`;
}

/** Where stage `index` of the `last + 1` stands: Sent at the left edge, Accepted at the right. */
const column = (index: number, last: number) => (index * (WIDTH - NODE)) / last;

/** The middle line of a band, so a thin one is easy to point at. */
function spine(x0: number, y0: number, x1: number, y1: number): string {
  const mid = (x0 + x1) / 2;
  return `M${x0},${y0} C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
}

type Stop = {
  key: string;
  stage: FunnelStage;
  outcome: FunnelOutcome;
  count: number;
  /** Of the applications that reached the stage, rounded. */
  percent: number;
  band: string;
  spine: string;
  x: number;
  y: number;
  height: number;
  /** Where its label is centred. */
  middle: number;
};

/**
 * Where everything goes. Stages share the top edge, so the onward flow is
 * a straight band; each stage's outcomes are stacked halfway to the next
 * stage, just below that onward flow, so their labels stay clear of the
 * bands that leave the next stage.
 */
function layout(funnel: readonly FunnelStep[]) {
  const sent = funnel[0].count;
  const unit = Math.min(MAX_UNIT, MAX_HEIGHT / sent);
  const last = funnel.length - 1;
  let height = sent * unit;
  const stops = funnel.slice(0, last).flatMap((step, index): Stop[] => {
    const from = column(index, last) + NODE;
    const to = (column(index, last) + column(index + 1, last)) / 2;
    let source = funnel[index + 1].count * unit;
    let top = source + DROP;
    return FUNNEL_OUTCOMES.filter((outcome) => step.stopped[outcome] > 0).map((outcome) => {
      const count = step.stopped[outcome];
      const size = count * unit;
      const slot = Math.max(size, SLOT);
      const y = top + (slot - size) / 2;
      const stop: Stop = {
        key: `${step.stage}-${outcome}`,
        stage: step.stage,
        outcome,
        count,
        percent: Math.round((count / step.count) * 100),
        band: band(from, source, to, y, size),
        spine: spine(from, source + size / 2, to, y + size / 2),
        x: to,
        y,
        height: size,
        middle: top + slot / 2,
      };
      source += size;
      top += slot + SPACE;
      height = Math.max(height, top - SPACE);
      return stop;
    });
  });
  return { unit, stops, height };
}

const percentOf = (x: number) => `${(x / WIDTH) * 100}%`;

/** How wide a tooltip can get: closer than this to the right edge, it opens to the left of the pointer. */
const TOOLTIP_ROOM = 240;

export function FunnelChart({ funnel }: { funnel: readonly FunnelStep[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  // The tooltip follows the pointer, so it stays clear of the node or band it's about.
  const [pointer, setPointer] = useState({ x: 0, y: 0, left: false });
  const picture = useRef<HTMLDivElement>(null);
  const sent = funnel[0].count;
  const last = funnel.length - 1;

  const note = (index: number) => {
    const step = funnel[index];
    if (index === 0) return "Everything you've sent";
    if (step.count === 0) return "None yet";
    return `${step.conversion}% of ${stageLabel(funnel[index - 1].stage).toLowerCase()}`;
  };

  const labels = (
    <ol className="relative h-[76px]">
      {funnel.map((step, index) => (
        <li
          key={step.stage}
          className={`absolute top-0 flex flex-col gap-1 whitespace-nowrap ${index === last ? "right-0 items-end text-right" : ""}`}
          style={index === last ? undefined : { left: percentOf(column(index, last)) }}
        >
          <Link
            href={stageHref(step.stage)}
            className={`flex flex-col gap-1 rounded-control text-ink no-underline hover:text-ink [&:hover>span:first-child]:underline ${index === last ? "items-end" : ""}`}
          >
            <span className="text-sm underline-offset-3">{stageLabel(step.stage)}</span>
            <span className="font-serif text-2xl leading-none tabular-nums">{step.count}</span>
            <span className="text-label leading-[1.35] text-muted">{note(index)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );

  if (sent === 0) {
    return (
      <div className="relative overflow-x-auto">
        <div className="min-w-[760px]">{labels}</div>
      </div>
    );
  }

  const { unit, stops, height } = layout(funnel);
  const follow = (event: PointerEvent) => {
    const box = picture.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - box.left;
    setPointer({ x, y: event.clientY - box.top, left: x > box.width - TOOLTIP_ROOM });
  };
  const hover = (key: string) => ({
    onPointerEnter: (event: PointerEvent) => {
      setHovered(key);
      follow(event);
    },
    onPointerMove: follow,
    onPointerLeave: () => setHovered((current) => (current === key ? null : current)),
  });
  const bandOpacity = (key: string) => (hovered === null ? 0.32 : hovered === key ? 0.55 : 0.12);
  const nodeOpacity = (key: string) => (hovered === null || hovered === key ? 1 : 0.35);

  const tooltip = (() => {
    if (hovered === null) return null;
    const stop = stops.find((entry) => entry.key === hovered);
    if (stop) {
      return {
        color: outcomeColor(stop.stage, stop.outcome),
        value: stop.count,
        text: outcomeSentence(stop.stage, stop.outcome, stop.count),
        detail: `${stop.percent}% of ${stageLabel(stop.stage).toLowerCase()}`,
      };
    }
    const index = funnel.findIndex((step) => `stage-${step.stage}` === hovered);
    if (index < 0) return null;
    const step = funnel[index];
    const stopped = FUNNEL_OUTCOMES.reduce((sum, outcome) => sum + step.stopped[outcome], 0);
    const next = funnel[index + 1];
    return {
      color: stageColor(step.stage),
      value: step.count,
      text: index === 0 ? "sent" : `reached ${stageLabel(step.stage).toLowerCase()}`,
      detail: next
        ? `${next.count} went on to ${stageLabel(next.stage).toLowerCase()}${stopped > 0 ? `, ${stopped} stopped here` : ""}`
        : note(index),
    };
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="relative overflow-x-auto">
        <div className="min-w-[760px] pb-1">
          {labels}
          {/* The picture; the labels above and the table below have the same numbers for screen readers and keyboards. */}
          <div className="relative" style={{ height }}>
            <div ref={picture} aria-hidden="true" className="absolute inset-0">
              <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                {funnel.map((step, index) => {
                  const key = `stage-${step.stage}`;
                  const size = step.count * unit;
                  const x = column(index, last);
                  return (
                    <g key={step.stage} {...hover(key)}>
                      {index > 0 && size > 0 && (
                        <rect
                          x={column(index - 1, last) + NODE}
                          width={x - column(index - 1, last) - NODE}
                          height={size}
                          style={{ fill: stageColor(step.stage), opacity: bandOpacity(key) }}
                          className="motion-safe:transition-opacity"
                        />
                      )}
                      {size > 0 ? (
                        <rect
                          x={x}
                          width={NODE}
                          height={size}
                          rx={2}
                          style={{ fill: stageColor(step.stage), opacity: nodeOpacity(key) }}
                          className="motion-safe:transition-opacity"
                        />
                      ) : (
                        // Nothing reached it yet: a hairline keeps its place.
                        <rect x={x} width={NODE} height={2} rx={1} className="fill-line-strong" />
                      )}
                      <rect x={x - NODE / 2} width={NODE * 2} height={Math.max(size, 14)} fill="transparent" />
                    </g>
                  );
                })}
                {stops.map((stop) => {
                  const color = outcomeColor(stop.stage, stop.outcome);
                  return (
                    <g key={stop.key} {...hover(stop.key)}>
                      <path d={stop.band} style={{ fill: color, opacity: bandOpacity(stop.key) }} className="motion-safe:transition-opacity" />
                      <path d={stop.spine} fill="none" stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" pointerEvents="stroke" />
                      <rect
                        x={stop.x}
                        y={stop.y}
                        width={NODE}
                        height={stop.height}
                        rx={2}
                        style={{ fill: color, opacity: nodeOpacity(stop.key) }}
                        className="motion-safe:transition-opacity"
                      />
                    </g>
                  );
                })}
              </svg>

              {tooltip && (
                <span
                  className={`pointer-events-none absolute z-10 -mt-3 -translate-y-full rounded-card border border-line-popover bg-card px-3 py-2 text-meta whitespace-nowrap shadow-menu ${
                    pointer.left ? "-ml-3 -translate-x-full" : "ml-3"
                  }`}
                  style={{ left: pointer.x, top: pointer.y }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: tooltip.color }} />
                    <strong className="font-medium text-ink tabular-nums">{tooltip.value}</strong> {tooltip.text}
                  </span>
                  <span className="block text-muted">{tooltip.detail}</span>
                </span>
              )}
            </div>
            {/* The end nodes' labels, over the picture: each opens its applications. */}
            {stops.map((stop) => (
              <Link
                key={stop.key}
                href={outcomeHref(stop.stage, stop.outcome)}
                {...hover(stop.key)}
                className={`absolute -translate-y-1/2 rounded-control text-meta whitespace-nowrap text-muted no-underline hover:text-ink hover:underline motion-safe:transition-opacity ${hovered !== null && hovered !== stop.key ? "opacity-50" : ""}`}
                style={{ left: `calc(${percentOf(stop.x + NODE)} + 6px)`, top: stop.middle }}
              >
                <span className="text-ink tabular-nums">{stop.count}</span> {outcomeLabel(stop.stage, stop.outcome)}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
        <details className="text-meta text-muted">
          <summary className="w-fit cursor-pointer hover:text-ink">Show the numbers</summary>
          <div className="relative overflow-x-auto">
            <table className="mt-3 w-full max-w-[640px] text-left tabular-nums">
              <caption className="sr-only">How far your sent applications got, and where the ones that stopped at each stage are now</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 font-medium text-ink">
                    Stage
                  </th>
                  {["Reached", "Of the stage before", "Still open", "Rejected", "Declined", "Archived"].map((heading) => (
                    <th key={heading} scope="col" className="py-1 pl-4 text-right font-medium text-ink">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {funnel.map((step, index) => (
                  <tr key={step.stage} className="border-t border-line">
                    <th scope="row" className="py-1 font-normal">
                      {stageLabel(step.stage)}
                    </th>
                    <td className="py-1 pl-4 text-right text-ink">{step.count}</td>
                    <td className="py-1 pl-4 text-right text-ink">{step.conversion === null ? "" : `${step.conversion}%`}</td>
                    {FUNNEL_OUTCOMES.map((outcome) => (
                      <td key={outcome} className="py-1 pl-4 text-right text-ink">
                        {index === last ? "" : step.stopped[outcome]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="text-meta text-muted">Click a stage to see its applications</p>
      </div>
    </div>
  );
}
