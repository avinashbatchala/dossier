import { cn } from "@/lib/cn";

/** Sizes: 22 px on board cards, 28 px in posting lists, 52 px in the application's Fit column. */
type Size = "sm" | "md" | "lg";

/** A ring filled to `fraction`, drawn in `box` px with a `stroke` px line. */
function Ring({ fraction, box, stroke }: { fraction: number; box: number; stroke: number }) {
  const radius = (box - stroke) / 2;
  const length = 2 * Math.PI * radius;
  return (
    <svg aria-hidden="true" width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="shrink-0 -rotate-90">
      <circle cx={box / 2} cy={box / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-track" />
      {fraction > 0 && (
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${fraction * length} ${length}`}
          className="stroke-primary"
        />
      )}
    </svg>
  );
}

/**
 * How many of a posting's requirements the profile covers (E27-2, decided
 * 16 November 2026: coverage, never a score out of 100). "5/7" with a ring
 * filled to five sevenths; a dash when there are no requirements yet.
 */
export function ScoreRing({ hit, total, size = "md", className }: { hit: number; total: number; size?: Size; className?: string }) {
  const label = total > 0 ? `${hit} of ${total} requirements covered` : "No requirements to cover yet";
  const text = total > 0 ? `${hit}/${total}` : "–";
  const fraction = total > 0 ? Math.min(1, Math.max(0, hit / total)) : 0;

  if (size === "lg") {
    return (
      <span role="img" aria-label={label} className={cn("relative grid size-[52px] flex-none place-items-center", className)}>
        <Ring fraction={fraction} box={52} stroke={3} />
        <span aria-hidden="true" className="absolute font-mono text-[13px] font-medium text-ink tabular-nums">
          {text}
        </span>
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-flex flex-none items-center gap-1 rounded-full border border-line-field bg-card font-mono text-ink tabular-nums",
        size === "sm" ? "h-[22px] pr-2 pl-1 text-[11px]" : "h-7 pr-2.5 pl-1.5 text-xs",
        className,
      )}
    >
      <Ring fraction={fraction} box={size === "sm" ? 12 : 14} stroke={2} />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
