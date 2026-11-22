"use client";

import { ArrowUpRight, Megaphone, ShieldAlert, TriangleAlert, type LucideIcon } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";

import { toast } from "@/components/toast";
import { dismissAnnouncement } from "@/lib/announcements/actions";
import type { Announcement, Severity } from "@/lib/announcements/contract";
import { cn } from "@/lib/cn";

/** What each severity says and looks like. The word is there so it's never only a colour. */
const SEVERITY: Record<Severity, { word: string; icon: LucideIcon; tone: string }> = {
  security: { word: "Security notice", icon: ShieldAlert, tone: "text-notice-security" },
  important: { word: "Important", icon: TriangleAlert, tone: "text-notice-important" },
  info: { word: "From Dossier", icon: Megaphone, tone: "text-on-inverse-muted" },
};

const never = () => () => {};

/**
 * The project's notice (announcements/check.ts): a card over the page, one at
 * a time, as plain text, that stays until it's dismissed. It's a dark card so
 * it stands out on any screen, and it never blocks one.
 *
 * It appears once the page has loaded, inside a live region that's already
 * there, so screen readers announce it and it comes in with its animation.
 */
export function AnnouncementNotice({ announcement }: { announcement: Announcement }) {
  const { id, severity, title, body, link } = announcement;
  const [hidden, setHidden] = useState(false);
  const loaded = useSyncExternalStore(never, () => true, () => false);
  const titleId = useId();
  const { word, icon: Icon, tone } = SEVERITY[severity];

  const dismiss = async () => {
    // The button is about to go, so focus moves to the page.
    document.getElementById("main")?.focus();
    setHidden(true);
    const result = await dismissAnnouncement({ id });
    if (!result.ok) {
      setHidden(false);
      toast(result.error);
    }
  };

  return (
    <div
      role={severity === "security" ? "alert" : "status"}
      className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-end print:hidden"
    >
      {loaded && !hidden && (
        <section
          aria-labelledby={titleId}
          className="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col gap-3 overflow-y-auto rounded-dialog bg-inverse p-5 text-on-inverse shadow-dialog ring-1 ring-line-strong sm:w-96 motion-safe:animate-notice-in"
        >
          <p className={cn("flex items-center gap-2.5 text-meta font-medium", tone)}>
            <span className="relative grid size-5 shrink-0 place-items-center">
              <span aria-hidden="true" className="absolute inset-0 rounded-full bg-current opacity-0 motion-safe:animate-notice-ping" />
              <Icon size={16} aria-hidden="true" className="relative" />
            </span>
            {word}
          </p>
          <h2 id={titleId} className="font-serif text-2xl leading-tight wrap-anywhere">
            {title}
          </h2>
          <p className="text-sm whitespace-pre-line text-on-inverse-muted wrap-anywhere">{body}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            {link && (
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-control bg-on-inverse px-3 py-1.5 text-sm font-semibold text-inverse hover:text-inverse hover:opacity-90 focus-visible:outline-on-inverse motion-safe:transition-opacity"
              >
                <span className="wrap-anywhere">
                  {link.label}{" "}
                  <span className="sr-only">(opens in a new tab)</span>
                </span>
                <ArrowUpRight size={15} aria-hidden="true" className="shrink-0" />
              </a>
            )}
            <button
              type="button"
              onClick={() => void dismiss()}
              className="inline-flex min-h-6 items-center text-sm font-medium text-on-inverse-muted hover:text-on-inverse focus-visible:outline-on-inverse"
            >
              Dismiss
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
