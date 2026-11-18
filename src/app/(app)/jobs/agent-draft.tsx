"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { PostingState } from "@/lib/job-search/search";

import { prepareAgentDraft } from "../agent/actions";

/**
 * A posting the job agent scored (E22-8): Prepare draft, which writes its
 * draft in the background for review on the Agent screen, or a link to the
 * draft once there is one.
 */
export function AgentDraft({ agent }: { agent: NonNullable<PostingState["agent"]> }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, startTransition] = useTransition();
  const job = useJob<{ applicationId: string }>(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      toast("The draft is ready for your review on the Agent screen.");
      router.refresh();
    } else if (update.status === "FAILED") {
      setJobId(null);
      toast(update.error ?? "The draft couldn't be prepared.");
      router.refresh();
    }
  });

  if (agent.status === "DRAFTED" && agent.applicationId) {
    return (
      <Link href={`/applications/${agent.applicationId}`} className={buttonClassName("secondary", "sm")}>
        Review the draft
      </Link>
    );
  }
  if (agent.status !== "SCORED" && agent.status !== "DRAFTING") return null;
  const preparing = starting || Boolean(jobId) || agent.status === "DRAFTING";

  const prepare = () =>
    startTransition(async () => {
      const result = toastResult(await prepareAgentDraft({ candidateId: agent.candidateId }));
      if (!result.ok) return;
      if (result.data.applicationId) router.refresh();
      else setJobId(result.data.jobId);
    });

  return (
    <>
      <Button variant="secondary" size="sm" aria-disabled={preparing || undefined} onClick={() => !preparing && prepare()}>
        {preparing ? "Preparing draft…" : "Prepare draft"}
      </Button>
      {jobId && job?.step && (
        <span role="status" className="text-meta text-muted">
          {job.step}
        </span>
      )}
    </>
  );
}
