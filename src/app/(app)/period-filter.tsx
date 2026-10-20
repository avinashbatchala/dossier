"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useOptimistic, useTransition, type ReactNode } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/dashboard";

import { rememberDashboardPeriod } from "./actions";

/** Whether the figures for a newly chosen period are still loading. */
const PendingContext = createContext(false);

/**
 * The dashboard's time filter (E9-8, DSH-7), in one row above everything it
 * scopes. The choice shows at once; while the new figures load, the old
 * ones stay, dimmed (see PeriodScoped).
 */
export function PeriodFilter({ period, children }: { period: DashboardPeriod; children: ReactNode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [shown, show] = useOptimistic(period);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-10 pb-5">
        <span id="period-label" className="text-meta text-muted">
          Showing
        </span>
        <SegmentedControl
          aria-labelledby="period-label"
          size="sm"
          options={DASHBOARD_PERIODS.map(({ value, label }) => ({ value, label }))}
          value={shown}
          onValueChange={(next) => {
            void rememberDashboardPeriod({ period: next });
            // The calendar's month stays.
            const query = new URLSearchParams(params);
            query.set("period", next);
            startTransition(() => {
              show(next);
              router.replace(`/?${query}`, { scroll: false });
            });
          }}
        />
      </div>
      <PendingContext value={pending}>{children}</PendingContext>
    </>
  );
}

/** What the period filter scopes: dimmed while the new figures load. */
export function PeriodScoped({ className, children }: { className?: string; children: ReactNode }) {
  const pending = use(PendingContext);
  return (
    <div aria-busy={pending || undefined} className={cn(className, pending && "opacity-60 motion-safe:transition-opacity")}>
      {children}
    </div>
  );
}
