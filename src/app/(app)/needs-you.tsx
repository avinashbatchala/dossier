"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/cn";
import type { NeedsYouItem } from "@/lib/dashboard";

import { QuietDays } from "./quiet-days";

/** Where a row's button goes: the right tab, and the work its click starts (U3), e.g. Prepare's checklist. */
export function needsYouHref(item: Pick<NeedsYouItem, "id" | "tab" | "action">): string {
  const query = new URLSearchParams();
  if (item.tab) query.set("tab", item.tab);
  if (item.action === "Follow up") query.set("tab", "email");
  if (item.action === "Prepare") query.set("start", "prepare");
  if (item.action === "Follow up") query.set("start", "follow-up");
  const text = query.toString();
  return `/applications/${item.id}${text ? `?${text}` : ""}`;
}

/** Rows shown before "Show all" (decided 16 November 2026, DB1). */
const NEEDS_YOU_LIMIT = 6;

/**
 * Needs you (E28-4, renamed from "Worth a look"): what's due this week first,
 * soonest on top, then what has no date. Each row opens its application on
 * the right tab; the whole row is the button's link.
 */
export function NeedsYou({ items, quietDays }: { items: NeedsYouItem[]; quietDays: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, NEEDS_YOU_LIMIT);
  return (
    <section aria-labelledby="needs-heading" className="flex flex-col rounded-panel border border-line-card bg-card px-6 pt-[22px] pb-3.5">
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 id="needs-heading" className="font-serif text-section">
          Needs you
        </h2>
        {items.length > 0 && <span className="text-meta text-muted">Due first, on top</span>}
      </div>
      {items.length === 0 ? (
        <p className="border-t border-line py-5 text-sm text-muted">All caught up. Nice.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id} className="relative flex items-center gap-3 border-t border-line py-[13px]">
              <StatusDot status={item.status} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-field">
                  <span className="font-medium">{item.company || item.role}</span>
                  {item.company && item.role && <span className="text-muted"> · {item.role}</span>}
                </p>
                <p className="text-meta text-muted">
                  {item.reason}
                  {item.due && (
                    <>
                      {" · "}
                      <span className={cn(item.soon && "text-warning")}>{item.due}</span>
                    </>
                  )}
                </p>
              </div>
              <Link
                href={needsYouHref(item)}
                // The whole row opens it; only the button takes focus.
                className={buttonClassName("secondary", "sm", "flex-none after:absolute after:inset-0")}
              >
                {item.action} <span className="sr-only">for {[item.company, item.role].filter(Boolean).join(", ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items.length > NEEDS_YOU_LIMIT && (
        <button type="button" onClick={() => setAll(!all)} className="self-start py-2 text-meta text-muted underline underline-offset-3 hover:text-ink">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
      <QuietDays days={quietDays} />
    </section>
  );
}
