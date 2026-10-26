import { cn } from "@/lib/cn";
import type { JobSource } from "@/lib/job-search/search";
import { attributionHref, SOURCE_INFO } from "@/lib/job-search/sources";

/** At least 116 × 23 px, as Adzuna's terms ask of its label. */
const badge = "inline-flex min-h-[23px] min-w-[116px] shrink-0 items-center justify-center rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-medium";

/** Whether a source's postings each carry a linked label, rather than plain text or nothing. */
export function linksAttribution(source: JobSource): boolean {
  return SOURCE_INFO[source].attributionLink !== null;
}

/**
 * The label a job source's terms ask for on its postings: plain text, or for
 * Adzuna a link to its site for the posting's country. As `placeholder`, it
 * only takes the badge's room, for a card the badge lies over (a button
 * can't hold a link).
 */
export function SourceAttribution({ source, url, placeholder, className }: { source: JobSource; url: string; placeholder?: boolean; className?: string }) {
  const text = SOURCE_INFO[source].attribution;
  const href = attributionHref(source, url);
  if (!text) return null;
  if (!href) return placeholder ? null : <p className={cn("text-xs text-muted", className)}>{text}</p>;
  if (placeholder) {
    return (
      <span aria-hidden className={cn(badge, "invisible", className)}>
        {text}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cn(badge, "text-muted hover:border-muted hover:text-ink", className)}>
      {text}{" "}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
