"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ScoreRing } from "@/components/score-ring";
import { toast } from "@/components/toast";
import { useJob } from "@/hooks/use-job";
import { coverageBand, matchScore, type Match } from "@/lib/application-data";

import { startCheckingRequirements } from "./actions";

/**
 * The top of the Fit column (E30-1, design 3b): the 52 px ring, its words
 * and "5 of 7 requirements covered · Check again". Check again checks the
 * requirements against the profile as it is now; the old match stays until
 * the new one is in. Coverage only, never a score out of 100 (U1).
 */
export function FitSummary({
  applicationId,
  match,
  checking,
  canCheck,
  note,
}: {
  applicationId: string;
  match: Match | null;
  checking: string | null;
  canCheck: boolean;
  /** In place of "5 of 7 requirements covered", e.g. while the documents are written (E31-5). */
  note?: string;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(checking);
  const [starting, startTransition] = useTransition();
  const job = useJob(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      router.refresh();
    }
    if (update.status === "FAILED") {
      toast(update.error ?? "The check didn't work. Try again.");
      setJobId(null);
    }
  });
  const busy = starting || (jobId !== null && job?.status !== "DONE" && job?.status !== "FAILED");
  const { hit, total } = match ? matchScore(match) : { hit: 0, total: 0 };

  const check = () =>
    startTransition(async () => {
      const result = await startCheckingRequirements({ id: applicationId });
      if (!result.ok) return toast(result.error);
      setJobId(result.data);
    });

  return (
    <div className="flex items-center gap-3.5" aria-busy={busy || undefined}>
      <ScoreRing hit={hit} total={total} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[15px] font-medium text-ink">{match ? coverageBand(match) : "Not checked yet"}</p>
        <p className="text-meta text-muted">
          {note ?? (total > 0 ? `${hit} of ${total} requirements covered` : "No requirements checked yet")}
          {canCheck && (
            <>
              {" · "}
              <button type="button" className="text-muted underline underline-offset-2 hover:text-ink disabled:no-underline" disabled={busy} onClick={check}>
                {busy ? "Checking…" : total > 0 ? "Check again" : "Check now"}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
