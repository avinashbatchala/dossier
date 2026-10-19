"use client";

import { CircleArrowUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { toast } from "@/components/toast";
import { UPGRADE_GUIDE_URL, type Release } from "@/lib/releases";
import { dismissUpdate } from "@/lib/update-actions";

import { useExpandSidebar, useSidebarCollapsed } from "./sidebar-frame";

// Each at least 24 px high (WCAG 2.2 target size), however small the text.
const TARGET = "inline-flex min-h-6 items-center";
const LINK = `${TARGET} font-medium text-ink underline underline-offset-2`;

/** The first link or button after `element` in the sidebar, in document order. */
function nextControl(element: HTMLElement | null): HTMLElement | null {
  if (!element) return null;
  const controls = (element.closest("aside") ?? document.body).querySelectorAll<HTMLElement>("a[href], button");
  return [...controls].find((control) => element.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING && !element.contains(control)) ?? null;
}

/**
 * The sidebar's notice while a newer release is out: what's new in it, how
 * to update, or "Not now", which hides it until a newer one still. While the
 * sidebar is collapsed it's an icon with a dot, which opens the sidebar to
 * show the notice.
 */
export function UpdateNotice({ release, currentVersion }: { release: Release; currentVersion: string }) {
  const [hidden, setHidden] = useState(false);
  const notice = useRef<HTMLElement>(null);
  const titleId = useId();
  const collapsed = useSidebarCollapsed();
  const expand = useExpandSidebar();
  const opened = useRef(false);

  // The icon is gone once the sidebar opens: focus goes to the notice it opened.
  useEffect(() => {
    if (collapsed || !opened.current) return;
    opened.current = false;
    notice.current?.querySelector<HTMLElement>("a[href]")?.focus();
  }, [collapsed]);

  if (hidden) return null;

  if (collapsed) {
    const label = `Dossier ${release.version} is out`;
    return (
      <button
        type="button"
        onClick={() => {
          opened.current = true;
          expand();
        }}
        aria-label={label}
        title={label}
        className="relative grid min-h-[34px] w-full place-items-center rounded-control text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors"
      >
        <CircleArrowUp size={16} aria-hidden="true" />
        <span aria-hidden="true" className="absolute top-1.5 right-2.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
      </button>
    );
  }

  const notNow = async () => {
    // Focus goes on to what follows the notice, rather than to the page.
    nextControl(notice.current)?.focus();
    setHidden(true);
    const result = await dismissUpdate({ version: release.version });
    if (!result.ok) {
      setHidden(false);
      toast(result.error);
    }
  };

  return (
    <section ref={notice} aria-labelledby={titleId} className="flex flex-col gap-1.5 rounded-control border border-line-card bg-card px-3 py-2.5">
      <h2 id={titleId} className="text-meta font-medium">
        Dossier {release.version} is out
      </h2>
      <p className="text-xs text-muted">You have {currentVersion}. Update to get its fixes and features.</p>
      <div className="flex flex-wrap gap-x-3 text-xs">
        <a href={release.url} target="_blank" rel="noopener noreferrer" className={LINK}>
          What&apos;s new{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <a href={UPGRADE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
          How to update{" "}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
        <button type="button" onClick={() => void notNow()} className={`${TARGET} text-muted hover:text-ink`}>
          Not now
        </button>
      </div>
    </section>
  );
}
