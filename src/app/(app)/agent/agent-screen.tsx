"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";

import { FilterChip, FilterChips, listingList, listingPreview, ListingRow, listingScreen, listingSplit, ListingTabs, PreviewBody, PreviewCard, PreviewFacts, PreviewHeader, PreviewReasons, RowTag, SourceBar } from "@/components/listing";
import { PageHeader } from "@/components/page-header";
import { ScoreRing } from "@/components/score-ring";
import { linksAttribution, SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJob } from "@/hooks/use-job";
import { AGENT_MAX_SOURCE_REQUESTS_PER_DAY } from "@/lib/agent/limits";
import type { AgentCandidateView, AgentView } from "@/lib/agent/view";
import { coversLine, fitWords, withoutPoints } from "@/lib/posting-coverage";

import { approveAgentDraft, dismissAgentCandidate, prepareAgentDraft, restoreAgentCandidate, runAgentNow } from "./actions";
import { AGENT_TABS, type AgentTab } from "./tabs";

type ScanResult = { message: string };

/** The tabs (E32-5, PL3): drafts waiting, what it scored that passes the cut-off, and what it left out, with why. */
const TAB_LABELS: Record<AgentTab, string> = { drafts: "Drafts to review", finds: "Best finds", skipped: "Skipped" };

const SETTINGS: Record<NonNullable<AgentView["setupSection"]>, { href: string; label: string }> = {
  agent: { href: "/settings?section=agent", label: "Settings → Job agent" },
  ai: { href: "/settings?section=ai", label: "Settings → AI provider" },
  jobs: { href: "/settings?section=jobs", label: "Settings → Job search" },
  scoring: { href: "/settings?section=scoring", label: "Settings → Scoring" },
};

/**
 * The Agent screen (E16-6, E32-5) on the list pattern: its searches and runs
 * in the source bar, tabs for its drafts, its best finds and what it
 * skipped, the list and a preview. Nothing here sends anything.
 */
export function AgentScreen({ view, tab = "drafts" }: { view: AgentView; tab?: AgentTab }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [runJobId, setRunJobId] = useState(view.runJobId);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<AgentCandidateView | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const prepare = (candidate: AgentCandidateView) =>
    startTransition(async () => {
      const result = toastResult(await prepareAgentDraft({ candidateId: candidate.id }));
      if (!result.ok) return;
      if (result.data.applicationId) return router.push(`/applications/${result.data.applicationId}`);
      toast("Preparing a draft. It shows under Drafts to review once it's ready.");
      router.refresh();
    });

  const approve = (candidate: AgentCandidateView) =>
    startTransition(async () => {
      if (toastResult(await approveAgentDraft({ candidateId: candidate.id })).ok) router.refresh();
    });

  const lists: Record<AgentTab, AgentCandidateView[]> = { drafts: view.drafts, finds: view.finds, skipped: view.skipped };
  const names = [...new Set([...view.drafts, ...view.finds, ...view.skipped].flatMap((candidate) => candidate.searches.map((entry) => entry.searchName)))];
  const shown = lists[tab].filter((candidate) => !hidden.has(candidate.id) && (!search || candidate.searches.some((entry) => entry.searchName === search)));
  const selected = shown.find((candidate) => candidate.id === selectedId) ?? shown[0] ?? null;
  const enabled = view.searches.filter((entry) => entry.enabled);
  const left = view.budget.map((portal) => Math.max(0, AGENT_MAX_SOURCE_REQUESTS_PER_DAY - portal.used));

  return (
    <div className={listingScreen}>
      <PageHeader
        title="Job agent"
        description="Once a day it searches with your saved searches, scores what's new against your profile and keeps the best. Drafts wait here for your review. Nothing is ever sent."
        actions={
          <Link href="/settings?section=agent" className="text-[13px] text-muted hover:text-ink">
            Agent settings
          </Link>
        }
      />
      <div className="flex flex-col gap-3 px-10 pb-4">
        <Notices view={view} />
        <SourceBar
          label="Agent"
          icon={<Bot size={16} />}
          chips={[...enabled.map((entry) => entry.name), view.nextRun ? `Next run ${view.nextRun}` : "Off"]}
          note={
            running ? (
              <span role="status">{run?.step ?? "Starting the run…"}</span>
            ) : (
              [view.lastRun ? `Ran ${view.lastRun.at}` : "Not run yet", left.length > 0 ? `${Math.min(...left)} of ${AGENT_MAX_SOURCE_REQUESTS_PER_DAY} requests left today` : ""].filter(Boolean).join(" · ")
            )
          }
          actions={
            <>
              <Link href="/settings?section=agent" className={buttonClassName("secondary", "sm")}>
                Searches
              </Link>
              <Button size="sm" aria-disabled={running || pending || undefined} onClick={() => !running && !pending && runNow()}>
                {running ? "Running…" : "Run all now"}
              </Button>
            </>
          }
        />
        {view.lastRun?.message && !running && <p className="text-meta text-muted">Last run: {view.lastRun.message}</p>}
        <details className="text-meta text-muted">
          <summary className="cursor-pointer hover:text-ink">Runs, searches and limits</summary>
          <div className="mt-3 flex max-w-[860px] flex-col gap-4">
            <dl className="rounded-card border border-line-card bg-card px-5 py-1">
              <Fact label="Agent">{view.enabled ? "Enabled" : "Off"}</Fact>
              <Fact label="Enabled searches">
                {enabled.length} of {view.searches.length}
              </Fact>
              <Fact label="Last run">{view.lastRun ? view.lastRun.at : "Not yet"}</Fact>
              <Fact label="Next run">{view.nextRun ?? "Off"}</Fact>
              <Fact label="Requests left in 24 hours">
                {view.budget.length > 0
                  ? view.budget.map((portal) => `${portal.name}: ${Math.max(0, AGENT_MAX_SOURCE_REQUESTS_PER_DAY - portal.used)} of ${AGENT_MAX_SOURCE_REQUESTS_PER_DAY}`).join(" · ")
                  : "No portal the agent can ask"}
              </Fact>
              <Fact label="Whole-batch quota eligibility">
                {view.nextEligibility} ({view.timeZone})
              </Fact>
            </dl>
            <section aria-label="Recurring searches" className="flex flex-col gap-3">
              {view.searches.length === 0 ? <p className="text-meta text-muted">No saved searches yet.</p> : <ol className="flex flex-col gap-3">
                {view.searches.map((search) => {
                  const last = view.searchHistory.find((result) => result.searchId === search.id);
                  return <li key={search.id} className="border-t border-line pt-3 text-sm">
                    <p className="break-words font-medium">{search.name} · {search.enabled ? "Enabled" : "Disabled"}</p>
                    <p className="text-meta text-muted break-words">{search.query.keywords}{search.query.place ? ` · ${search.query.place}` : ""} · {search.query.country.toUpperCase() || "No country selected"}</p>
                    <p className="text-meta text-muted">{last ? `${last.error ? "Last source request failed" : "Last source request completed"}: ${last.at} · ${last.found} found · ${last.fresh} new to agent` : "Not run yet (no retained result)."}</p>
                    {last && <p className="text-xs text-muted">{last.batchMessage ? `Batch outcome: ${last.batchMessage}` : "Batch pending or still processing; discovery counts may be incomplete."}</p>}
                    {last?.searchName !== undefined && last.searchName !== search.name && <p className="text-xs text-muted">Run as “{last.searchName}”</p>}
                    {last?.error && <p className="text-meta text-error">{last.error}</p>}
                  </li>;
                })}
              </ol>}
              {view.searchResults.length > 0 && <div className="border-t border-line pt-3">
                <h3 className="text-field font-medium">Last batch discovery results</h3>
                <ul className="mt-2 flex flex-col gap-2 text-meta text-muted">{view.searchResults.map((result) => <li key={result.searchId} className="break-words">
                  {result.searchName}{!view.searches.some((search) => search.id === result.searchId) ? " (deleted search)" : ""}: {result.found} found · {result.fresh} new to agent{result.error ? ` · ${result.error}` : " · Every portal answered"}
                </li>)}</ul>
              </div>}
              <p className="text-meta text-muted">Found counts may overlap between searches; do not add them up as unique postings. New to agent is counted at each search, before the shared batch is deduplicated and scored. Candidates retain the search names used when found, even after renaming or deletion.</p>
              <p className="text-meta text-muted">Each enabled search asks every portal switched on that covers its country for its first page; the Bundesagentur für Arbeit is never asked. Each portal takes at most {AGENT_MAX_SOURCE_REQUESTS_PER_DAY} requests in a rolling 24 hours, including failed attempts, on top of its own plan. A run waits until the whole batch fits; manual runs also wait at least an hour after the previous run. Each run shares a limit of {view.maxScores} AI scores{view.autoDraft ? ` and ${view.maxDrafts} automatic drafts` : "; automatic drafts are off"} across all searches; what it doesn&apos;t score stays in Positions unscored.</p>
            </section>
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line px-10">
        <ListingTabs
          label="What it found"
          current={tab}
          tabs={AGENT_TABS.map((key) => ({ key, label: TAB_LABELS[key], count: lists[key].filter((candidate) => !hidden.has(candidate.id)).length, href: key === "drafts" ? "/agent" : `/agent?tab=${key}` }))}
        />
        {names.length > 1 && (
          <div className="pb-2">
            <FilterChips>
              <FilterChip label="Search" value={search} options={[{ value: "", label: "any" }, ...names.map((name) => ({ value: name, label: name }))]} onChange={setSearch} />
            </FilterChips>
          </div>
        )}
      </div>

      <div className={listingSplit}>
        <div className={listingList}>
          {shown.length === 0 ? (
            <p className="mx-5 my-4 rounded-card border border-line-card bg-card px-5 py-4 text-sm text-muted">
              {tab === "drafts"
                ? view.autoDraft
                  ? "No drafts yet. After a run, the best new postings get a draft here."
                  : "No drafts yet. Prepare one from Best finds, or let the agent prepare them in Settings → Job agent."
                : tab === "finds"
                  ? "Nothing waiting. After a run, what covers enough of its requirements shows here, best fit first."
                  : "Nothing skipped yet."}
            </p>
          ) : (
            <>
              <p className="px-5 pt-3 pb-1 text-meta text-muted">
                {tab === "finds" && coversLine(view.covers) ? `Each ${coversLine(view.covers)}, best fit first` : tab === "skipped" ? "Newest first, each with why" : "Best fit first"}
              </p>
              <ul aria-label={TAB_LABELS[tab]} className="flex flex-col border-t border-line">
                {shown.map((candidate) => (
                  <li key={candidate.id}>
                    <ListingRow
                      selected={candidate.id === selected?.id}
                      onClick={() => setSelectedId(candidate.id)}
                      lead={
                        candidate.coverage.total > 0 ? (
                          <ScoreRing hit={candidate.coverage.hit} total={candidate.coverage.total} />
                        ) : (
                          <span aria-hidden="true" className="block h-7 w-11 rounded-full border border-dashed border-line-strong" />
                        )
                      }
                      title={candidate.title}
                      tag={tab === "drafts" ? <RowTag tone="success">Draft</RowTag> : undefined}
                      sub={[candidate.company, candidate.facts].filter(Boolean).join(" · ")}
                      meta={
                        tab === "skipped"
                          ? candidate.why
                          : [candidate.searches.length > 0 ? `Found by ${candidate.searches.map((entry) => entry.searchName).join(", ")}` : "", tab === "drafts" ? "resume and letter ready" : candidate.origin]
                              .filter(Boolean)
                              .join(" · ")
                      }
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {selected && (
          <AgentPreview
            key={selected.id}
            candidate={selected}
            tab={tab}
            busy={pending}
            onPrepare={() => prepare(selected)}
            onApprove={() => approve(selected)}
            onDismiss={() => (tab === "drafts" ? setConfirming(selected) : dismiss(selected))}
          />
        )}
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
    </div>
  );
}

/** The selected one: its actions, how it fits, the facts, and the posting. */
function AgentPreview({
  candidate,
  tab,
  busy,
  onPrepare,
  onApprove,
  onDismiss,
}: {
  candidate: AgentCandidateView;
  tab: AgentTab;
  busy: boolean;
  onPrepare: () => void;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const headingId = useId();
  const reasons = [...candidate.reasons.map((text) => ({ text: withoutPoints(text), good: true })), ...candidate.redFlags.map((text) => ({ text: withoutPoints(text), good: false }))];
  const kicker = tab === "drafts" ? `Draft ready · ${candidate.origin}` : tab === "finds" ? `Best find · ${candidate.origin}` : (candidate.why ?? candidate.origin);
  return (
    <section
      aria-labelledby={headingId}
      className={listingPreview}
    >
      <PreviewHeader
        id={headingId}
        kicker={kicker}
        title={candidate.title}
        sub={[candidate.company, candidate.facts].filter(Boolean).join(" · ")}
        actions={
          <>
            {tab === "drafts" && candidate.applicationId && (
              <>
                <Link href={`/applications/${candidate.applicationId}`} className={buttonClassName("primary", "sm")}>
                  Review draft <span aria-hidden="true">→</span>
                </Link>
                <Button variant="secondary" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && onApprove()}>
                  Approve
                </Button>
              </>
            )}
            {tab === "finds" && (
              <Button size="sm" aria-disabled={busy || candidate.draftJobId !== null || undefined} onClick={() => !busy && !candidate.draftJobId && onPrepare()}>
                {candidate.draftJobId ? "Preparing the draft…" : "Prepare draft"}
              </Button>
            )}
            {candidate.url && (
              <a href={candidate.url} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
                Open posting<span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </>
        }
        quiet={
          <Button variant="text" size="sm" onClick={onDismiss}>
            {tab === "drafts" ? "Dismiss with its draft" : "Dismiss"}
          </Button>
        }
      />
      {candidate.error && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          The last try at a draft didn&apos;t work: {candidate.error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PreviewCard label="How it fits">
          <div className="flex items-center gap-3.5">
            <ScoreRing hit={candidate.coverage.hit} total={candidate.coverage.total} size="lg" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-[15px] font-medium text-ink">{candidate.coverage.total === 0 && tab === "skipped" ? "Not scored" : fitWords(candidate.coverage)}</p>
              <p className="text-meta text-muted">{candidate.coverage.total > 0 ? `${candidate.coverage.hit} of ${candidate.coverage.total} requirements covered` : "No requirements counted"}</p>
            </div>
          </div>
          {reasons.length > 0 && <PreviewReasons reasons={reasons} />}
        </PreviewCard>
        <PreviewCard label="Facts">
          <PreviewFacts
            facts={[
              { label: "Draft", value: tab === "drafts" ? "Resume and letter, ready to review" : "", tone: "success" as const },
              { label: "Found by", value: candidate.searches.map((entry) => `${entry.searchName}${entry.searchId === null ? " (deleted search)" : ""}`).join(", ") },
              { label: "Listed", value: candidate.origin },
              { label: "Sent?", value: "No. The agent never sends" },
            ].filter((fact) => fact.value)}
          />
          {/* As the source's terms ask (E14-2); the origin names the others. */}
          {linksAttribution(candidate.source) && <SourceAttribution source={candidate.source} url={candidate.url} className="self-start" />}
        </PreviewCard>
      </div>
      {candidate.description && (
        <div role="region" aria-label="Posting text" className="border-t border-line pt-5">
          <PreviewBody>{candidate.description}</PreviewBody>
        </div>
      )}
    </section>
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
        {view.drafts.length + view.waiting > 0 && ". What it found before is still here, and in Positions."}
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
  if (view.limitReached) return note(`The whole batch needs more source requests than are available. Quota is next available ${view.nextEligibility} (${view.timeZone}).`);
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
