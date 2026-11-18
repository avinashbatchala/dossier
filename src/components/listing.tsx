"use client";

import { ListFilter } from "lucide-react";
import Link from "next/link";
import { type ComponentProps, type ReactNode } from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

// One pattern for Positions, Startups and the job agent (E32-1, spec §6):
// a source bar saying where the list comes from, underlined tabs for where
// each item stands, round filter chips behind a filter icon, a 600 px list
// whose selected row has a bar on its left, and a preview with one main
// action, two cards and the text. Tabs and filters never share a style.

/*
 * The layout of a list-and-preview screen (#520). From `lg` the screen keeps
 * to the window and never scrolls as a page: the list and the preview each
 * scroll on their own, with one scrollbar apiece. Below `lg` the preview
 * sits on top and the page scrolls as usual.
 */
/** The screen: its header, bars and the split, as tall as the window from `lg`. */
export const listingScreen = "flex flex-col lg:h-panel lg:min-h-[560px]";
/** The list beside the preview: it takes the rest of the screen's height, at least 360 px, so a tall header (an open search form) scrolls the page instead of hiding the list. */
export const listingSplit = "flex flex-wrap items-start pb-16 lg:min-h-[360px] lg:flex-1 lg:flex-nowrap lg:items-stretch lg:pb-0";
/** The 600 px list (E32-1), scrolling on its own from `lg`. */
export const listingList = "flex w-full min-w-0 flex-col border-line lg:w-[min(600px,48%)] lg:flex-none lg:overflow-y-auto lg:border-r lg:pb-16";
/** The preview, scrolling on its own from `lg`. */
export const listingPreview = "flex w-full min-w-0 flex-col gap-5 px-10 py-7 max-lg:order-first lg:w-auto lg:flex-1 lg:overflow-y-auto";

/** Where the list comes from: an icon, its query as chips, a note, Edit and the main action; Edit opens `editor` in place. */
export function SourceBar({
  icon,
  chips,
  note,
  actions,
  editor,
  label,
}: {
  icon: ReactNode;
  chips: readonly ReactNode[];
  /** "Searched today 08:12 · 4 portals · 31 found". */
  note?: ReactNode;
  /** Edit, then the main action. */
  actions: ReactNode;
  /** The full form, while Edit has it open. */
  editor?: ReactNode;
  label: string;
}) {
  return (
    <section aria-label={label} className="flex flex-col rounded-[12px] border border-line-card bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <span aria-hidden="true" className="flex-none text-muted">
          {icon}
        </span>
        <ul aria-label="What it looks for" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {chips.map((chip, index) => (
            <li key={index} className="rounded-[7px] bg-track px-2.5 py-1 text-[13px] text-ink">
              {chip}
            </li>
          ))}
        </ul>
        {note && <p className="text-meta text-muted">{note}</p>}
        <div className="flex flex-none items-center gap-2">{actions}</div>
      </div>
      {editor && <div className="border-t border-line px-4 py-4">{editor}</div>}
    </section>
  );
}

/** A tab: where items stand, as a link, with its count. */
export type ListingTab = { key: string; label: string; count: number; href: string };

/** Underlined tabs with counts; each is a link, so the tab is in the URL. */
export function ListingTabs({ tabs, current, label }: { tabs: readonly ListingTab[]; current: string; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-6 gap-y-1">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex items-baseline gap-1.5 border-b-2 pt-2 pb-2.5 text-sm",
                  active ? "border-primary font-medium text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {tab.label}{" "}
                <span className="text-[12px] font-normal text-muted tabular-nums">{tab.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The filter icon, then the chips: what narrows the list, never where items stand. */
export function FilterChips({ children, label = "Filters" }: { children: ReactNode; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <ListFilter size={15} aria-hidden="true" className="mr-1 text-muted" />
      {children}
    </div>
  );
}

/**
 * A round chip that opens a menu: "Portal: any ▾" (#519). The menu is the
 * app's own (Radix), with the arrow keys, typeahead and Escape, the current
 * choice ticked. A chip set to something other than its first option is
 * filled. Its name is its visible text, "Portal: any".
 */
export function FilterChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const chosen = options.find((option) => option.value === value) ?? options[0];
  const set = value !== options[0]?.value;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[13px] data-[state=open]:border-primary",
          set ? "border-line-strong bg-selected text-ink" : "border-line-control text-muted hover:text-ink data-[state=open]:text-ink",
        )}
      >
        <span className="max-w-[240px] truncate">
          {label}: <span className={cn(set && "font-medium")}>{chosen?.label}</span>
        </span>
        <span aria-hidden="true" className="text-[10px]">
          ▾
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(360px,var(--radix-dropdown-menu-content-available-height))] max-w-[min(420px,calc(100vw-2rem))] overflow-y-auto"
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A row of the list: what leads it (the coverage ring), the title, a tag,
 * the facts and a meta line. The selected row has `bg-selected` and a 3 px
 * bar in `primary` on its left.
 */
export function ListingRow({
  lead,
  title,
  tag,
  sub,
  meta,
  selected,
  dimmed = false,
  className,
  ...button
}: {
  lead?: ReactNode;
  title: string;
  /** New / Saved / Applied / Draft. */
  tag?: ReactNode;
  sub: ReactNode;
  meta?: ReactNode;
  selected: boolean;
  dimmed?: boolean;
} & Omit<ComponentProps<"button">, "title">) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3.5 border-b border-line px-5 py-3.5 text-left hover:bg-hover",
        selected && "bg-selected shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-selected",
        dimmed && "opacity-60",
        className,
      )}
      {...button}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-start justify-between gap-3">
          <span className="truncate text-[14.5px] font-medium text-ink">{title}</span>
          {tag}
        </span>
        <span className="truncate text-[13px] text-ink/85">{sub}</span>
        {meta && <span className="truncate text-[12.5px] text-muted">{meta}</span>}
      </span>
      {/* First on screen, last in the button's name: the title is what it's called. */}
      {lead !== undefined && <span className="order-first flex w-12 flex-none justify-center pt-0.5">{lead}</span>}
    </button>
  );
}

/** A row's tag: "New", "Saved", "Applied", "Draft". */
export function RowTag({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "success" }) {
  return (
    <span className={cn("flex-none rounded-[5px] px-1.5 py-px text-[11.5px]", tone === "success" ? "bg-success/15 text-success" : "bg-track text-ink")}>{children}</span>
  );
}

/** The top of the preview: kicker, title, sub, then the actions with a quiet one on the right. */
export function PreviewHeader({
  id,
  kicker,
  title,
  sub,
  actions,
  quiet,
}: {
  /** The title's id, which names the preview. */
  id: string;
  kicker?: ReactNode;
  title: string;
  sub?: ReactNode;
  actions: ReactNode;
  /** Dismiss, at the far end. */
  quiet?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {kicker && <p className="text-[12.5px] text-muted">{kicker}</p>}
      <h2 id={id} className="font-serif text-[32px] leading-[1.15] tracking-[-0.01em] text-pretty">
        {title}
      </h2>
      {sub && <p className="text-sm text-ink/85">{sub}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {actions}
        {quiet && <span className="ml-auto">{quiet}</span>}
      </div>
    </div>
  );
}

/** One of the preview's two cards. */
export function PreviewCard({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <section aria-label={label} className={cn("flex min-w-0 flex-col gap-3 rounded-[12px] border border-line-card bg-card px-5 py-4", className)}>
      {children}
    </section>
  );
}

/** The facts card's rows: only what's known is listed. */
export function PreviewFacts({ facts }: { facts: readonly { label: string; value: ReactNode; tone?: "warning" | "success" }[] }) {
  return (
    <dl className="flex flex-col">
      {facts.map((fact) => (
        <div key={fact.label} className="grid grid-cols-[110px_1fr] gap-3 border-b border-line py-2 text-[13.5px] last:border-b-0">
          <dt className="text-muted">{fact.label}</dt>
          <dd className={cn("min-w-0 break-words", fact.tone === "warning" ? "text-warning" : fact.tone === "success" ? "text-success" : "text-ink")}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Reasons with ✓ (success) or – (warning). */
export function PreviewReasons({ reasons }: { reasons: readonly { text: string; good: boolean }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {reasons.map((reason, index) => (
        <li key={index} className="flex gap-2.5 text-[13.5px] text-ink">
          <span aria-hidden="true" className={cn("w-3 flex-none", reason.good ? "text-success" : "text-warning")}>
            {reason.good ? "✓" : "–"}
          </span>
          <span className="sr-only">{reason.good ? "In favour: " : "Against: "}</span>
          <span className="min-w-0">{reason.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** The posting's own text, in serif. */
export function PreviewBody({ children }: { children: ReactNode }) {
  return <div className="max-w-[760px] font-serif text-[17px] leading-[1.65] whitespace-pre-line text-ink">{children}</div>;
}
