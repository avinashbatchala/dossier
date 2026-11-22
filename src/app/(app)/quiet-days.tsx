"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { controlBaseClassName } from "@/components/ui/field";
import { SelectControl } from "@/components/ui/select";
import { QUIET_DAYS_CHOICES } from "@/lib/dashboard";
import { cn } from "@/lib/cn";

import { rememberQuietDays } from "./actions";

/**
 * How long without news before Needs you suggests a follow-up (E9-9),
 * under the list it changes. A value set elsewhere (an import) stays listed.
 */
export function QuietDays({ days }: { days: number }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, show] = useOptimistic(days);
  const choices = [...new Set([...QUIET_DAYS_CHOICES, days])].sort((a, b) => a - b);

  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3.5 pb-1.5 text-meta text-muted">
      <label htmlFor="quiet-days">Suggest a follow-up after</label>
      <SelectControl
        compact
        id="quiet-days"
        value={shown}
        onChange={(event) => {
          const next = Number(event.target.value);
          startTransition(async () => {
            show(next);
            if (toastResult(await rememberQuietDays({ days: next })).ok) router.refresh();
          });
        }}
        className={cn(controlBaseClassName, "py-1 text-meta")}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice} {choice === 1 ? "day" : "days"}
          </option>
        ))}
      </SelectControl>
      <span>without news</span>
    </p>
  );
}
