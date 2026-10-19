import Link from "next/link";
import type { ReactNode } from "react";

import type { CalendarItem } from "@/lib/calendar-view";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/dates";

/** An interview stands out; other events are quiet. */
export const itemColours = (item: CalendarItem) =>
  item.kind === "interview" ? "bg-primary text-on-primary hover:bg-primary-hover hover:text-on-primary" : "bg-selected text-ink hover:bg-hover hover:text-ink";

/** "13:00–13:45", or "All day". */
export const itemTime = (item: CalendarItem, timeZone: string) =>
  item.allDay ? "All day" : `${formatTime(item.start, timeZone)}–${formatTime(item.end, timeZone)}`;

/** The item as a link to its application, or to Google Calendar in a new tab, or as text. */
export function ItemLink({ item, className, children }: { item: CalendarItem; className?: string; children: ReactNode }) {
  const classes = cn("block overflow-hidden rounded-[6px] no-underline", itemColours(item), className);
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
