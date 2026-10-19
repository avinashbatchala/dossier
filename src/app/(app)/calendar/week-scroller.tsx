"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The week's hours, scrolled to the start of the working day when they open. */
export function WeekScroller({ top, children }: { top: number; children: ReactNode }) {
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (area.current) area.current.scrollTop = top;
  }, [top]);
  return (
    // Focusable, so the hours scroll from the keyboard too, links in them or not.
    <div ref={area} role="region" aria-label="Hours of the week" tabIndex={0} className="scrollbar-subtle max-h-[calc(100dvh-300px)] min-h-[360px] overflow-y-auto">
      {children}
    </div>
  );
}
