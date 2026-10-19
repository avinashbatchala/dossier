"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { buttonClassName } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { CalendarView } from "@/lib/calendar-view";

/** Moves through the weeks or months, back to today, and switches between them. */
export function CalendarToolbar({
  view,
  title,
  links,
}: {
  view: CalendarView;
  /** "19–25 Oct 2026" or "October 2026". */
  title: string;
  links: { previous: string; next: string; today: string; week: string; month: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const unit = view === "week" ? "week" : "month";
  return (
    <div aria-busy={pending || undefined} className="flex flex-wrap items-center justify-between gap-3 px-10 pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={links.previous} aria-label={`Previous ${unit}`} title={`Previous ${unit}`} className={buttonClassName("secondary", "sm", "px-2!")}>
          <ChevronLeft size={16} aria-hidden="true" />
        </Link>
        <Link href={links.next} aria-label={`Next ${unit}`} title={`Next ${unit}`} className={buttonClassName("secondary", "sm", "px-2!")}>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
        <Link href={links.today} className={buttonClassName("secondary", "sm")}>
          Today
        </Link>
        <h2 className="ml-2 font-serif text-section">{title}</h2>
      </div>
      <SegmentedControl
        aria-label="Show"
        size="sm"
        options={[
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
        value={view}
        onValueChange={(next) => startTransition(() => router.push(next === "week" ? links.week : links.month))}
      />
    </div>
  );
}
