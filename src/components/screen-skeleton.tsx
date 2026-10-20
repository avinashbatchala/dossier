import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { PageBar } from "./page-header";
import { PageBarIcon } from "./page-bar-icon";

type Variant = "dashboard" | "list" | "document" | "form";

function Block({ className }: { className?: string }) {
  return <div className={cn("rounded-card bg-track", className)} />;
}

const bodies: Record<Variant, ReactNode> = {
  // The calendar shows beside the cards where there's room (see the dashboard's Columns).
  dashboard: (
    <div className="@container px-10 pb-16">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 @min-[1240px]:grid-cols-[minmax(0,1200px)_400px]">
        <div className="grid max-w-[1200px] grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))] gap-5">
          <Block className="col-span-full h-56 rounded-panel" />
          <Block className="h-72 rounded-panel" />
          <Block className="h-72 rounded-panel" />
        </div>
        <Block className="hidden h-[440px] rounded-panel @min-[1240px]:block" />
      </div>
    </div>
  ),
  list: (
    <div className="flex flex-col gap-6 px-10 pb-16">
      <div className="flex flex-wrap gap-3">
        <Block className="h-9 w-72 max-w-full" />
        <Block className="h-9 w-44" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Block key={index} className="h-14" />
        ))}
      </div>
    </div>
  ),
  document: (
    <div className="flex flex-1 flex-wrap border-t border-line">
      <div className="flex flex-[999_1_480px] justify-center bg-canvas px-10 pt-11 pb-16">
        <Block className="aspect-[1/1.414] w-full max-w-[640px] rounded-none bg-card" />
      </div>
      <div className="flex flex-[1_0_300px] flex-col gap-3 px-7 pt-7">
        <Block className="h-5 w-40" />
        <Block className="h-24" />
        <Block className="h-24" />
      </div>
    </div>
  ),
  form: (
    <div className="flex max-w-[860px] flex-col gap-5 px-10 pb-16">
      <Block className="h-48 rounded-panel" />
      <Block className="h-64 rounded-panel" />
      <Block className="h-40 rounded-panel" />
    </div>
  ),
};

/**
 * Stands in for a screen while it loads (E11-4): the shape of its header and
 * content, quietly pulsing. It fades in after a moment, so a quick load
 * doesn't flash.
 */
export function ScreenSkeleton({ label, variant }: { label: string; variant: Variant }) {
  return (
    <div role="status" className="flex flex-1 flex-col animate-skeleton-in">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-1 flex-col motion-safe:animate-pulse">
        <PageBar>
          <div className="flex items-center gap-3">
            <PageBarIcon />
            <Block className="h-11 w-72 max-w-full" />
          </div>
        </PageBar>
        <div className="px-10 pt-1 pb-8">
          <Block className="h-5 w-[480px] max-w-full" />
        </div>
        {bodies[variant]}
      </div>
    </div>
  );
}
