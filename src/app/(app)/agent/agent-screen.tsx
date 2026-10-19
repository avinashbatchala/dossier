"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJob } from "@/hooks/use-job";
import { cn } from "@/lib/cn";
import { dismissAgentCandidate, prepareAgentDraft, runAgentNow, approveAgentCandidate } from "@/lib/agent/actions";
import type { AgentCandidateView, AgentView } from "@/lib/agent/data";
import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { SOURCE_INFO } from "@/lib/job-search/sources";

type ScanResult = { found: number; fresh: number; scored: number; drafted: number; skipped: number; message: string | null };
type DraftResult = { applicationId: string };

/** The job agent's screen: run it, then review scored postings and prepared drafts. */
export function AgentScreen({ view }: { view: AgentView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runJobId, setRunJobId] = useState<string | null>(
    view.job && (view.job.status === "QUEUED" || view.job.status === "RUNNING") ? view.job.id : null,
  );
  const [draftJob, setDraftJob] = useState<{ id: string; candidateId: string } | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);

  const runJob = useJob<ScanResult>(runJobId, 0, (job) => {
    if (job.status === "DONE" || job.status === "FAILED") {
      setRunJobId(null);
      toast(job.status === "DONE" ? (job.result?.message ?? "Agent run finished.") : (job.error ?? "The agent run failed."));
      router.refresh();
    }
  });
  const draft = useJob<DraftResult>(draftJob?.id ?? null, 0, (job) => {
    if (job.status === "DONE" && job.result) {
      setDraftJob(null);
      toast("Draft ready for review.");
      router.refresh();
    } else if (job.status === "FAILED") {
      setDraftJob(null);
      toast(job.error ?? "The draft couldn't be prepared.");
      router.refresh();
    }
  });

  const running = pending || Boolean(runJob && (runJob.status === "QUEUED" || runJob.status === "RUNNING")) || Boolean(draftJob);
  const drafted = view.queue.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED);
  const scored = view.queue.filter((candidate) => candidate.status === AgentCandidateStatus.SCORED);
  const drafting = view.queue.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTING);
  const lastMessage = view.job?.result && typeof view.job.result === "object" && "message" in view.job.result
    ? String((view.job.result as { message?: unknown }).message ?? "")
    : "";

  const run = () =>
    startTransition(async () => {
      const result = toastResult(await runAgentNow({}));
      if (!result.ok) return;
      setRunJobId(result.data.jobId);
      if (result.data.reused) toast("The agent is already running.");
    });

  const prepare = (candidateId: string) =>
    startTransition(async () => {
      const result = toastResult(await prepareAgentDraft({ candidateId }));
      if (!result.ok) return;
      if (result.data.applicationId) {
        router.push(`/applications/${result.data.applicationId}`);
        return;
      }
      if (result.data.jobId) setDraftJob({ id: result.data.jobId, candidateId });
    });

  const approve = (candidateId: string) =>
    startTransition(async () => {
      const result = toastResult(await approveAgentCandidate({ candidateId }));
      if (result.ok) router.push(`/applications/${result.data.applicationId}`);
    });

  const dismiss = (candidateId: string) => {
    setDismissId(null);
    startTransition(async () => {
      if (toastResult(await dismissAgentCandidate({ candidateId })).ok) router.refresh();
    });
  };

  return (
    <>
      <PageHeader
        title="Job agent"
        description="It searches once a day, scores new postings against your profile, and prepares drafts for the best ones. You review every draft; nothing is sent without you."
        actions={
          <Button onClick={() => void run()} disabled={running || !view.enabled}>
            {running ? "Working…" : "Run now"}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 px-10 pb-20">
        {!view.enabled && (
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            The job agent is off. Turn it on in{" "}
            <Link href="/settings?section=agent" className="underline">
              Settings → Job agent
            </Link>
            . You can still review anything already in the queue.
          </p>
        )}

        {(runJob || draft) && (
          <p role="status" className="rounded-card border border-line-card bg-card px-4 py-3 text-meta text-muted">
            {runJob ? (runJob.step ?? "Starting the agent…") : draft?.step ?? "Preparing a draft…"}
          </p>
        )}

        <Card className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatusItem label="Search" value={view.searchLine || "Not set"} />
          <StatusItem label="Source" value={view.source ? SOURCE_INFO[view.source].name : "Not chosen"} />
          <StatusItem label="Schedule" value={`Every day at ${String(view.hour).padStart(2, "0")}:00`} />
          <StatusItem label="Next run" value={view.nextRunLabel ?? (view.enabled ? "Not scheduled" : "Paused")} />
          <StatusItem label="Last run" value={view.lastRunAt ?? "Never"} />
          <StatusItem label="Minimum score" value={String(view.minScore)} />
          <StatusItem
            label="Per run"
            value={`Scores ${view.maxScores} · ${view.autoDraft && view.maxDrafts > 0 ? `drafts ${view.maxDrafts}` : "no drafts"}`}
          />
          <StatusItem label="Queue" value={`${drafted.length} drafts · ${scored.length} scored`} />
        </Card>

        {lastMessage && !runJob && <p className="text-meta text-muted">Last run: {lastMessage}</p>}

        <section aria-labelledby="agent-drafts" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="agent-drafts" className="font-serif text-section">
              Drafts to review
            </h2>
            <p className="text-meta text-muted">{drafted.length} waiting</p>
          </div>
          {drafted.length === 0 ? (
            <p className="rounded-card border border-line-card bg-card px-4 py-5 text-sm text-muted">
              {view.enabled
                ? "No prepared drafts yet. A run will put the best matches here."
                : "Turn the agent on to start preparing drafts."}
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {drafted.map((candidate) => (
                <li key={candidate.id}>
                  <CandidateCard
                    candidate={candidate}
                    minScore={view.minScore}
                    busy={running}
                    onPrepare={() => void prepare(candidate.id)}
                    onApprove={() => void approve(candidate.id)}
                    onDismiss={() => setDismissId(candidate.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="agent-scored" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="agent-scored" className="font-serif text-section">
              Scored postings
            </h2>
            <p className="text-meta text-muted">{scored.length} waiting</p>
          </div>
          {drafting.length > 0 && (
            <p className="text-meta text-muted">
              {drafting.length} {drafting.length === 1 ? "draft is" : "drafts are"} being prepared.
            </p>
          )}
          {scored.length === 0 ? (
            <p className="rounded-card border border-line-card bg-card px-4 py-5 text-sm text-muted">
              No scored postings waiting. The agent keeps the best matches and skips ones you saved, dismissed or applied to.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {scored.map((candidate) => (
                <li key={candidate.id}>
                  <CandidateCard
                    candidate={candidate}
                    minScore={view.minScore}
                    busy={running}
                    onPrepare={() => void prepare(candidate.id)}
                    onApprove={() => void approve(candidate.id)}
                    onDismiss={() => setDismissId(candidate.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={dismissId !== null}
        onOpenChange={(open) => {
          if (!open) setDismissId(null);
        }}
        title="Dismiss this posting?"
        description="The agent won't suggest it again. If a draft was prepared, it will be removed from Applications too."
        confirmLabel="Dismiss"
        onConfirm={() => {
          if (dismissId) dismiss(dismissId);
        }}
      />
    </>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  );
}

function CandidateCard({
  candidate,
  minScore,
  busy,
  onPrepare,
  onApprove,
  onDismiss,
}: {
  candidate: AgentCandidateView;
  minScore: number;
  busy: boolean;
  onPrepare: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const drafted = candidate.status === AgentCandidateStatus.DRAFTED;
  const drafting = candidate.status === AgentCandidateStatus.DRAFTING;
  const title = candidate.title.trim() || "Untitled posting";
  const company = candidate.company.trim() || "Unknown company";
  const source = SOURCE_INFO[candidate.source];
  const facts = [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · ");

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-serif text-[21px] leading-tight text-pretty">{title}</h3>
          <p className="text-sm text-muted">{company}</p>
          {facts && <p className="text-meta text-muted">{facts}</p>}
          <p className="text-xs text-muted">
            {source.name}
            {candidate.via ? ` · via ${candidate.via}` : ""}
            {candidate.posted ? ` · posted ${candidate.posted}` : ""}
          </p>
        </div>
        <span
          aria-label={`Match score ${candidate.score} of 100`}
          className={cn(
            "grid size-12 flex-none place-items-center rounded-full border text-sm font-semibold",
            candidate.score >= Math.max(minScore, 85)
              ? "border-primary bg-primary text-on-primary"
              : candidate.score >= minScore
                ? "border-warning-line bg-warning-surface text-warning"
                : "border-line-field bg-input text-muted",
          )}
        >
          {candidate.score}
        </span>
      </div>

      {candidate.reasons.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {candidate.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}

      {candidate.redFlags.length > 0 && (
        <div className="rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
          <p className="font-medium">Worth knowing</p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
            {candidate.redFlags.map((flag, index) => (
              <li key={index}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      {candidate.error && (
        <p role="alert" className="text-meta text-error">
          {candidate.error}
        </p>
      )}

      {candidate.description && (
        <details className="text-sm text-muted">
          <summary className="w-fit cursor-pointer text-meta text-muted hover:text-ink">Posting text</summary>
          <p className="mt-2 max-h-64 overflow-y-auto text-pretty whitespace-pre-wrap">{candidate.description.slice(0, 4000)}</p>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3.5">
        {drafted && candidate.applicationId ? (
          <>
            <Link href={`/applications/${candidate.applicationId}`} className={buttonClassName("primary", "sm")}>
              Review draft
            </Link>
            <Button variant="secondary" size="sm" onClick={onApprove} disabled={busy}>
              Approve
            </Button>
          </>
        ) : drafting ? (
          <Button variant="secondary" size="sm" disabled>
            Preparing draft…
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onPrepare} disabled={busy}>
            Prepare draft
          </Button>
        )}
        {candidate.url && (
          <a href={candidate.url} target="_blank" rel="noreferrer noopener" className={buttonClassName("secondary", "sm")}>
            Open posting
          </a>
        )}
        <Button variant="danger-text" size="sm" onClick={onDismiss} disabled={busy} className="ml-auto">
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
