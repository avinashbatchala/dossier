"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { ScoreBadge } from "@/components/score-badge";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJob } from "@/hooks/use-job";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow } from "./actions";

type ScanResult = { message: string };
type DraftResult = { applicationId: string };

const SETTINGS: Record<NonNullable<AgentView["setupSection"]>, { href: string; label: string }> = {
  agent: { href: "/settings?section=agent", label: "Settings → Job agent" },
  ai: { href: "/settings?section=ai", label: "Settings → AI provider" },
  jobs: { href: "/settings?section=jobs", label: "Settings → Job search" },
};

/**
 * The Agent screen (E16-6): what the job agent searches, when it runs, the
 * drafts it prepared and the postings it scored, waiting for a look. Nothing
 * here sends anything.
 */
export function AgentScreen({ view }: { view: AgentView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runJobId, setRunJobId] = useState(view.runJobId);
  const [showBelow, setShowBelow] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<AgentCandidateView | null>(null);

  const run = useJob<ScanResult>(runJobId, 0, (job) => {
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    setRunJobId(null);
    toast(job.status === "DONE" ? (job.result?.message ?? "The run is done.") : (job.error ?? "The run didn't finish."));
    router.refresh();
  });
  const running = Boolean(runJobId) && (!run || run.status === "QUEUED" || run.status === "RUNNING");

  const runNow = () =>
    startTransition(async () => {
      const result = toastResult(await runAgentNow({}));
      if (result.ok) setRunJobId(result.data.jobId);
    });

  const hide = (id: string, gone: boolean) =>
    setHidden((current) => {
      const next = new Set(current);
      if (gone) next.add(id);
      else next.delete(id);
      return next;
    });

  const dismiss = (candidate: AgentCandidateView) =>
    startTransition(async () => {
      hide(candidate.id, true);
      const result = await dismissAgentCandidate({ candidateId: candidate.id });
      if (!result.ok) {
        hide(candidate.id, false);
        return toast(result.error);
      }
      const undo = result.data.undo;
      if (!undo) return toast("Dismissed, with its draft. It won't come back.");
      toast("Dismissed. It won't come back.", {
        action: {
          label: "Undo",
          onClick: () =>
            void restoreAgentCandidate({ ...undo, reasons: stringList(undo.reasons), redFlags: stringList(undo.redFlags) }).then((restored) => {
              if (!toastResult(restored).ok) return;
              hide(candidate.id, false);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });

  const drafts = view.drafts.filter((candidate) => !hidden.has(candidate.id));
  const scored = view.scored.filter((candidate) => !hidden.has(candidate.id));
  const below = view.belowMinimum.filter((candidate) => !hidden.has(candidate.id));
  const empty = drafts.length === 0 && scored.length === 0;

  return (
    <>
      <PageHeader
        title="Job agent"
        description="Once a day it searches for new postings, scores them against your profile, and keeps the best here for you. Drafts wait for your review, and nothing is ever sent."
        actions={
          <Button aria-disabled={running || pending || undefined} onClick={() => !running && !pending && runNow()}>
            {running ? "Running…" : "Run now"}
          </Button>
        }
      />
      <div className="flex flex-col gap-8 px-10 pb-20">
        <Notices view={view} />

        <Card padding="none" className="px-7 py-2">
          <dl>
            <Fact label="Searches for">{view.search ?? "Nothing yet"}</Fact>
            <Fact label="Last run">
              {view.lastRun ? (
                <>
                  {view.lastRun.at}
                  {view.lastRun.message && <span className="block text-muted">{view.lastRun.message}</span>}
                </>
              ) : (
                "Not yet"
              )}
            </Fact>
            <Fact label="Next run">{view.nextRun ?? "Off"}</Fact>
          </dl>
          {running && (
            <p role="status" className="border-t border-line py-3.5 text-sm text-muted">
              {run?.step ?? "Starting the run…"}
            </p>
          )}
        </Card>

        <Section title="Drafts to review" count={drafts.length}>
          {drafts.length === 0 ? (
            <Empty>
              {view.autoDraft
                ? "No drafts yet. After a run, the best new postings get a draft here."
                : "No drafts yet. Prepare one from a scored posting, or let the agent prepare them in Settings → Job agent."}
            </Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {drafts.map((candidate) => (
                <li key={candidate.id}>
                  <CandidateCard candidate={candidate}>
                    <Link href={`/applications/${candidate.applicationId}`} className={buttonClassName("primary", "sm", "hover:text-on-primary")}>
                      Review draft
                    </Link>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        startTransition(async () => {
                          if (toastResult(await approveAgentDraft({ candidateId: candidate.id })).ok) router.refresh();
                        })
                      }
                    >
                      Approve
                    </Button>
                    <OpenPosting url={candidate.url} />
                    <Button variant="danger-text" size="sm" className="ml-auto" onClick={() => setConfirming(candidate)}>
                      Dismiss
                    </Button>
                  </CandidateCard>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Scored postings" count={scored.length}>
          {scored.length === 0 ? (
            <Empty>{empty ? "Nothing waiting yet. A run puts the postings that fit you best here." : "No postings waiting for a draft."}</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {scored.map((candidate) => (
                <li key={candidate.id}>
                  <ScoredCard candidate={candidate} onDismiss={() => dismiss(candidate)} />
                </li>
              ))}
            </ul>
          )}
          {below.length > 0 && (
            <div className="flex flex-col gap-3">
              <button type="button" aria-expanded={showBelow} onClick={() => setShowBelow(!showBelow)} className="w-fit text-meta text-muted underline underline-offset-2 hover:text-ink">
                {below.length} below your minimum score of {view.minScore} · {showBelow ? "Hide" : "Show"}
              </button>
              {showBelow && (
                <ul className="flex flex-col gap-3">
                  {below.map((candidate) => (
                    <li key={candidate.id}>
                      <ScoredCard candidate={candidate} onDismiss={() => dismiss(candidate)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Dismiss this draft?"
        description="Its resume, cover letter and chat are deleted, and the posting won't come back."
        confirmLabel="Dismiss draft"
        onConfirm={() => {
          if (confirming) dismiss(confirming);
          setConfirming(null);
        }}
      />
    </>
  );
}

const stringList = (value: unknown): string[] | null => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null);

/** Why the agent isn't running, and where to fix it. */
function Notices({ view }: { view: AgentView }) {
  const note = (children: ReactNode) => (
    <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
      {children}
    </p>
  );
  if (!view.enabled) {
    return note(
      <>
        The job agent is off.{" "}
        <Link href={SETTINGS.agent.href} className="font-medium text-warning underline underline-offset-2">
          Turn it on in Settings → Job agent
        </Link>
        {view.drafts.length + view.scored.length > 0 && ". What it found before is still here."}
      </>,
    );
  }
  if (view.setupProblem && view.setupSection) {
    return note(
      <>
        {view.setupProblem.replace(/ in Settings → [^.]+ first\.$/, ".")}{" "}
        <Link href={SETTINGS[view.setupSection].href} className="font-medium text-warning underline underline-offset-2">
          Go to {SETTINGS[view.setupSection].label}
        </Link>
      </>,
    );
  }
  if (view.limitReached) return note("The agent has run 3 times in the past 24 hours, as many as it may. It runs again once a day has passed since the first.");
  return null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-3.5 text-sm first:border-t-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="sm:text-right">{children}</dd>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = `agent-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-serif text-section">
          {title}
        </h2>
        <p className="text-meta text-muted">{count} waiting</p>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">{children}</p>;
}

function OpenPosting({ url }: { url: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
      Open posting <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** A posting the agent found: what it is, its score and why. The actions go below. */
function CandidateCard({ candidate, children }: { candidate: AgentCandidateView; children: ReactNode }) {
  return (
    <Card padding="none" className="flex flex-col gap-3.5 px-6 py-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-serif text-[20px] leading-tight text-pretty">{candidate.title}</h3>
          {candidate.company && <p className="text-sm text-ink">{candidate.company}</p>}
          {candidate.facts && <p className="text-meta text-muted">{candidate.facts}</p>}
          {candidate.origin && <p className="text-xs text-muted">{candidate.origin}</p>}
        </div>
        <ScoreBadge score={candidate.score} />
      </div>
      {candidate.reasons.length > 0 && (
        <ul aria-label="Why it fits" className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
          {candidate.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      )}
      {candidate.redFlags.length > 0 && (
        <div className="rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
          <p className="font-medium">Worth knowing</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
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
      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-3.5">{children}</div>
    </Card>
  );
}

/** A scored posting: Prepare draft (following the job while it writes), Open posting, Dismiss. */
function ScoredCard({ candidate, onDismiss }: { candidate: AgentCandidateView; onDismiss: () => void }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(candidate.draftJobId);
  const [starting, startTransition] = useTransition();
  const job = useJob<DraftResult>(jobId, 0, (update) => {
    if (update.status === "DONE") {
      setJobId(null);
      toast("The draft is ready for your review.");
      router.refresh();
    } else if (update.status === "FAILED") {
      setJobId(null);
      toast(update.error ?? "The draft couldn't be prepared.");
      router.refresh();
    }
  });
  const preparing = starting || Boolean(jobId);

  const prepare = () =>
    startTransition(async () => {
      const result = toastResult(await prepareAgentDraft({ candidateId: candidate.id }));
      if (!result.ok) return;
      if (result.data.applicationId) router.refresh();
      else setJobId(result.data.jobId);
    });

  return (
    <CandidateCard candidate={candidate}>
      <Button size="sm" aria-disabled={preparing || undefined} onClick={() => !preparing && prepare()}>
        {preparing ? "Preparing draft…" : "Prepare draft"}
      </Button>
      <OpenPosting url={candidate.url} />
      {preparing && job?.step && (
        <span role="status" className="text-meta text-muted">
          {job.step}
        </span>
      )}
      <Button variant="danger-text" size="sm" className="ml-auto" onClick={onDismiss}>
        Dismiss
      </Button>
    </CandidateCard>
  );
}
