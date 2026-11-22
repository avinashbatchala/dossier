"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { WritableKind } from "@/lib/jobs/write-document";

import { startWritingDocument } from "./actions";

const NAMES: Record<WritableKind, string> = { RESUME: "tailored resume", COVER_LETTER: "cover letter" };

/**
 * In place of a document the application was created without (#367): it
 * says so, and writes it on request, in the background. A reloaded page
 * picks up a document still being written.
 */
export function WriteMissingDocument({
  applicationId,
  kind,
  aiReady,
  writing,
}: {
  applicationId: string;
  kind: WritableKind;
  aiReady: boolean;
  /** The job writing it, e.g. since before a reload. */
  writing: string | null;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState(writing);
  const [starting, startTransition] = useTransition();
  const job = useJob(jobId, 0, (update) => {
    if (update.status === "DONE") router.refresh();
    if (update.status === "FAILED") {
      toast(update.error ?? "Writing it didn't work. Try again.");
      setJobId(null);
    }
  });
  const busy = starting || (jobId !== null && job?.status !== "FAILED");

  const write = () =>
    startTransition(async () => {
      const result = await startWritingDocument({ id: applicationId, kind });
      if (!result.ok) return toast(result.error);
      setJobId(result.data);
    });

  return (
    <div className="flex flex-1 justify-center overflow-auto bg-canvas px-10 pt-16 pb-[var(--composer-space,4rem)]">
      <div className="flex max-w-[420px] flex-col items-center gap-4 text-center">
        <p className="text-muted">
          {busy
            ? `${job?.step ?? `Writing the ${NAMES[kind]}`}…`
            : `This application was created without a ${NAMES[kind]}.${aiReady ? "" : " Writing one needs an AI provider, in Settings → AI provider."}`}
        </p>
        {aiReady && (
          <Button variant="secondary" disabled={busy} onClick={write}>
            {busy ? "Writing…" : `Write the ${NAMES[kind]}`}
          </Button>
        )}
      </div>
    </div>
  );
}
