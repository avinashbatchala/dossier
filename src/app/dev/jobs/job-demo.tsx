"use client";

import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import { cancel, retry } from "@/lib/jobs/actions";

import { startDemoJob } from "./actions";

export function JobDemo({ initialId }: { initialId: string | null }) {
  const [id, setId] = useState(initialId);
  const [revision, setRevision] = useState(0);
  const job = useJob(id, revision);

  const start = async (fail: boolean) => {
    const result = toastResult(await startDemoJob({ fail }));
    if (result.ok && result.data) setId(result.data);
  };

  return (
    <>
      <PageHeader title="Jobs" description="A demo job with named steps, to try the background runner. Reload while it runs: it carries on." />
      <div className="flex flex-col gap-4 px-10">
        <div className="flex gap-2">
          <Button onClick={() => void start(false)}>Start a job</Button>
          <Button variant="secondary" onClick={() => void start(true)}>Start one that fails</Button>
        </div>
        {job && (
          <div className="flex flex-col gap-2 rounded-card border border-line-card bg-card p-5" data-testid="job">
            <p>
              <strong>{job.status}</strong> {job.step && `· ${job.step}`}
            </p>
            {job.error && <p className="text-error">{job.error}</p>}
            {job.status === "RUNNING" && (
              <Button variant="text" className="self-start" onClick={() => void cancel({ id: job.id })}>
                Cancel
              </Button>
            )}
            {job.status === "FAILED" && (
              <Button
                variant="secondary"
                className="self-start"
                onClick={async () => {
                  if (toastResult(await retry({ id: job.id })).ok) setRevision((count) => count + 1);
                }}
              >
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
