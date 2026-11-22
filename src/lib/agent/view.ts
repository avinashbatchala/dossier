import "server-only";

import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { postedAgo } from "@/lib/job-search/search";
import { sourceInfo } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { byBestFit, COVERS_LABELS, passes, type Covers, type Coverage } from "@/lib/posting-coverage";
import { agentCoversOf, type AgentSearchRun } from "@/lib/settings";

import { candidateCoverage, SKIP_WORDS, stringsOf, type SkipReason } from "./candidates";
import { AGENT_JOB_KEY } from "./jobs";
import { agentPlan, agentPortals, agentSetupProblem, planSlots } from "./run";
import { interruptedRunMessage, nextSourceBudgetAt, sourceRequestsInPastDay } from "./runs";
import { nextAgentRun } from "./schedule";
import { listAgentSearches } from "./searches";
import type { SavedAgentSearch } from "./search";
import { isAgentScanRunning } from "./scan-lock";

// What the Agent screen shows (E16-6): since E22-8, the drafts to review, the
// searches and runs. What it scored is in Positions, Found by the agent.

export type AgentCandidateView = {
  /** Historical names survive renames/deletion; searchId can be null. */
  searches: { searchId: string | null; searchName: string }[];
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch". */
  origin: string;
  /** A source that's no longer listed keeps its id (#269). */
  source: string;
  url: string;
  /** Its best profile's coverage (E32-2). */
  coverage: Coverage;
  reasons: string[];
  redFlags: string[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
  /** The posting's text, for the preview (E32-5). */
  description: string;
  /** Under Skipped (E32-5): why it was left out. */
  why?: string;
};

export type AgentView = {
  /** Recurring search collection, including disabled searches, in run order. */
  searches: SavedAgentSearch[];
  /** Requests sent to each portal the agent asks in the past 24 hours (E22-8). */
  budget: { portal: string; name: string; used: number }[];
  nextEligibility: string;
  timeZone: string;
  searchHistory: (AgentSearchRun & { at: string; batchMessage: string | null })[];
  searchResults: AgentSearchRun[];
  enabled: boolean;
  autoDraft: boolean;
  /** The queue's cut-off (E32-2). */
  covers: Covers;
  maxScores: number;
  maxDrafts: number;
  /** Why it can't run: no search, scorer, source or key; null when it's set up. */
  setupProblem: string | null;
  /** Which settings section fixes it. */
  setupSection: "agent" | "ai" | "jobs" | "scoring" | null;
  /** The daily limit is used up. */
  limitReached: boolean;
  lastRun: { at: string; message: string | null } | null;
  /** In the user's zone; null while the agent is off. */
  nextRun: string | null;
  /** A run queued or running, to follow. */
  runJobId: string | null;
  drafts: AgentCandidateView[];
  /** Best finds (E32-5): what it scored that passes the cut-off, best fit first. */
  finds: AgentCandidateView[];
  /** Skipped (E32-5, PL3): under the cut-off, or never scored, newest first, each with why. */
  skipped: AgentCandidateView[];
  /** How many Best finds wait for a look (E22-8). */
  waiting: number;
};

/** The Agent item's badge (E16-6): drafts waiting for review. What it scored waits in Positions (E22-8). */
export async function countAgentQueue(): Promise<number> {
  return prisma.agentCandidate.count({ where: { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } } });
}

/** "Today" and "Yesterday" in a sentence; "2 days ago" or "15 Oct" as they are. */
const posted = (ago: string) => (ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago);

const sectionOf = (problem: string): AgentView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Scoring") ? "scoring" : problem.includes("Job search") ? "jobs" : "agent";

export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const withSearches = { searches: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { searchId: true, searchName: true } } };
  const [settings, timeZone, candidates, scored, skippedRows, draftJobs, runJobs, searches, config] = await Promise.all([
    loadSettings(),
    lastKnownTimeZone(),
    prisma.agentCandidate.findMany({
      where: { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: withSearches,
    }),
    // What it scored, waiting: Best finds, or under the cut-off (E32-5).
    prisma.agentCandidate.findMany({ where: { status: AgentCandidateStatus.SCORED, skipReason: null }, orderBy: { createdAt: "desc" }, take: 300, include: withSearches }),
    // What a run left unscored, saying why (E32-5).
    prisma.agentCandidate.findMany({ where: { status: AgentCandidateStatus.SCORED, skipReason: { not: null } }, orderBy: { createdAt: "desc" }, take: 200, include: withSearches }),
    prisma.job.findMany({
      where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true, key: true },
    }),
    prisma.job.findMany({ where: { key: AGENT_JOB_KEY, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true }, take: 1 }),
    listAgentSearches(),
    loadJobSearchConfig(),
  ]);
  // Present an interrupted reservation even when quota prevents another run.
  // This is read-only: taking the scan lock on render can reject the very job
  // a Run now action has just started. The next scan persists reconciliation
  // while owning execution. A queued/live job keeps its pending outcome.
  if (!runJobs.length && settings.agentRuns.some((run) => run.message === null) && !await isAgentScanRunning()) {
    for (const run of settings.agentRuns) if (run.message === null) run.message = interruptedRunMessage(run);
  }
  const draftJob = new Map(draftJobs.map((job) => [job.key?.replace(/^agent-candidate:/, ""), job.id]));

  const setupProblem = await agentSetupProblem();

  const view = (candidate: (typeof candidates)[number]): AgentCandidateView => ({
    searches: candidate.searches,
    id: candidate.id,
    title: candidate.title.trim() || "Untitled posting",
    company: candidate.company.trim(),
    facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
    origin: [
      candidate.postedAt ? `Posted ${posted(postedAgo(candidate.postedAt.toISOString(), now))}` : "",
      [candidate.via ? `via ${candidate.via}` : "", `on ${sourceInfo(candidate.source).name}`].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" · "),
    source: candidate.source,
    url: candidate.url,
    coverage: candidateCoverage(candidate),
    reasons: stringsOf(candidate.reasons),
    redFlags: stringsOf(candidate.redFlags),
    error: candidate.error,
    applicationId: candidate.applicationId,
    draftJobId: draftJob.get(candidate.id) ?? null,
    description: candidate.description,
  });
  const last = settings.agentRuns[0];
  const slots = planSlots(agentPlan(searches, config));
  // With nothing to run yet, whether a request to each portal would fit.
  const eligible = nextSourceBudgetAt(settings.agentRuns, now, slots.length > 0 ? slots : agentPortals(config));
  const covers = agentCoversOf(settings);
  const bestFirst = (rows: typeof scored) => rows.map((candidate) => ({ candidate, coverage: candidateCoverage(candidate), at: candidate.createdAt.getTime() })).sort(byBestFit).map(({ candidate }) => candidate);
  const finds = bestFirst(scored.filter((candidate) => passes(candidateCoverage(candidate), covers))).map(view);
  const under = scored
    .filter((candidate) => !passes(candidateCoverage(candidate), covers))
    .map((candidate) => ({
      at: candidate.createdAt.getTime(),
      view: { ...view(candidate), why: candidate.requirements > 0 ? `Covers ${candidate.covered} of ${candidate.requirements}: under your cut-off (${COVERS_LABELS[covers].toLowerCase()})` : "Lists no requirements to check" },
    }));
  const skips = skippedRows.map((candidate) => ({ at: candidate.createdAt.getTime(), view: { ...view(candidate), why: SKIP_WORDS[candidate.skipReason as SkipReason] ?? "Not scored" } }));
  const skipped = [...under, ...skips].sort((a, b) => b.at - a.at).map((entry) => entry.view);
  const waiting = finds.length;

  return {
    searches,
    budget: agentPortals(config).map((portal) => ({ portal, name: sourceInfo(portal).name, used: sourceRequestsInPastDay(settings.agentRuns, now, portal) })),
    nextEligibility: eligible > now ? formatDateTime(eligible, timeZone, now) : "Now",
    timeZone,
    searchHistory: searches.flatMap((search) => {
      const run = settings.agentRuns.find((run) => run.searches?.some((result) => result.searchId === search.id));
      const result = run?.searches?.find((result) => result.searchId === search.id);
      return run && result ? [{ ...result, at: formatDateTime(new Date(run.at), timeZone, now), batchMessage: run.message }] : [];
    }),
    searchResults: last?.searches ?? [],
    enabled: settings.agentEnabled,
    autoDraft: settings.agentAutoDraft,
    covers,
    maxScores: settings.agentMaxScores,
    maxDrafts: settings.agentMaxDrafts,
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    limitReached: eligible > now,
    lastRun: last ? { at: formatDateTime(new Date(last.at), timeZone, now), message: last.message } : null,
    nextRun: settings.agentEnabled ? formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns, slots), timeZone, now) : null,
    runJobId: runJobs[0]?.id ?? null,
    // Best fit first (E32-2).
    drafts: bestFirst(candidates).map(view),
    finds,
    skipped,
    waiting,
  };
}
