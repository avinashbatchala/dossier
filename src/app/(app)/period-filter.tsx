"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition, type ReactNode } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/dashboard";

import { rememberDashboardPeriod } from "./actions";

/**
 * The dashboard's time filter (E9-8, DSH-7), in one row above everything it
 * scopes. The choice shows at once; while the new figures load, the old
 * ones stay, dimmed.
 */
export function PeriodFilter({ period, children }: { period: DashboardPeriod; children: ReactNode }) {
  const router = useRouter();
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
            startTransition(() => {
              show(next);
              router.replace(`/?period=${next}`, { scroll: false });
            });
          }}
        />
      </div>
      <div aria-busy={pending || undefined} className={pending ? "opacity-60 motion-safe:transition-opacity" : undefined}>
        {children}
      </div>
    </>
  );
}
