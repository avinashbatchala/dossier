import Link from "next/link";
import type { ReactNode } from "react";

import type { CalendarItem } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";

/** An interview's dot is dark, another event's faint: the same marks as on the month. */
export const itemDot = (item: CalendarItem) => (item.kind === "interview" ? "bg-primary" : "bg-faint");

/** "13:00–13:45", or "All day". */
export const itemTime = (item: CalendarItem, timeZone: string) =>
  item.allDay ? "All day" : `${formatTime(item.start, timeZone)}–${formatTime(item.end, timeZone)}`;

/** The item as a link to its application, or to Google Calendar in a new tab, or as text. */
export function ItemLink({ item, className, children }: { item: CalendarItem; className?: string; children: ReactNode }) {
  const classes = cn("block rounded-control text-ink no-underline", item.href && "hover:bg-hover hover:text-ink", className);
  if (!item.href) return <div className={classes}>{children}</div>;
  if (!item.external) {
    return (
      <Link href={item.href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={classes}>
      {children}
      <span className="sr-only"> (opens Google Calendar in a new tab)</span>
    </a>
  );
}
