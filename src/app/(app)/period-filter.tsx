"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { createContext, use, useOptimistic, useTransition, type ReactNode } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/lib/cn";
import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/dashboard";

import { rememberDashboardPeriod } from "./actions";

/** Whether the figures for a newly chosen period are still loading. */
const PendingContext = createContext(false);
/** The period on show, and choosing another. */
const ChoiceContext = createContext<{ shown: DashboardPeriod; choose: (next: DashboardPeriod) => void } | null>(null);

/**
 * The time filter's state (E9-8, DSH-7), for a PeriodControl placed anywhere
 * inside, and the PeriodScoped parts it dims. The choice shows at once;
 * while the new figures load, the old ones stay, dimmed.
 */
export function PeriodProvider({
  period,
  path = "/",
  remember = true,
  children,
}: {
  period: DashboardPeriod;
  /** The screen it filters, which takes `?period=`. */
  path?: string;
  /** Keeps the choice as the dashboard's for next time. */
  remember?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [shown, show] = useOptimistic(period);
  const choose = (next: DashboardPeriod) => {
    if (remember) void rememberDashboardPeriod({ period: next });
    // The calendar's month stays.
    const query = new URLSearchParams(params);
    query.set("period", next);
    startTransition(() => {
      show(next);
      router.replace(`${path}?${query}`, { scroll: false });
    });
  };
  return (
    <ChoiceContext value={{ shown, choose }}>
      <PendingContext value={pending}>{children}</PendingContext>
    </ChoiceContext>
  );
}

/** The 30 days / 90 days / All time switch, inside a PeriodProvider. */
export function PeriodControl(props: { "aria-label": string } | { "aria-labelledby": string }) {
  const choice = use(ChoiceContext);
  if (!choice) throw new Error("PeriodControl needs a PeriodProvider around it.");
  return <SegmentedControl {...props} size="sm" options={DASHBOARD_PERIODS.map(({ value, label }) => ({ value, label }))} value={choice.shown} onValueChange={choice.choose} />;
}

/**
 * The time filter in one row above everything it scopes, as the Usage
 * screen has it (#290), which doesn't remember its choice.
 */
export function PeriodFilter({
  period,
  path = "/",
  remember = true,
  children,
}: {
  period: DashboardPeriod;
  path?: string;
  remember?: boolean;
  children: ReactNode;
}) {
  return (
    <PeriodProvider period={period} path={path} remember={remember}>
      <div className="flex flex-wrap items-center gap-3 px-10 pb-5">
        <span id="period-label" className="text-meta text-muted">
          Showing
        </span>
        <PeriodControl aria-labelledby="period-label" />
      </div>
      {children}
    </PeriodProvider>
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
