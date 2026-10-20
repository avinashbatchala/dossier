import "server-only";

import { AgentCandidateStatus, JobStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/dates";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { countryName } from "@/lib/job-search/countries";
import { describeSearch, postedAgo, type JobSource } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { stringsOf } from "./candidates";
import { AGENT_JOB_KEY } from "./jobs";
import { agentSetupProblem } from "./run";
import { AGENT_MAX_RUNS_PER_DAY, runsInPastDay } from "./runs";
import { nextAgentRun } from "./schedule";

// What the Agent screen shows (E16-6).

export type AgentCandidateView = {
  id: string;
  title: string;
  company: string;
  /** "Rotterdam · Remote · €70k", what's known of them. */
  facts: string;
  /** "Posted 2 days ago · via LinkedIn on JSearch". */
  origin: string;
  url: string;
  score: number;
  reasons: string[];
  redFlags: string[];
  /** Why the last try at a draft failed. */
  error: string | null;
  /** The draft, once there is one. */
  applicationId: string | null;
  /** The job preparing its draft, while one is queued or running. */
  draftJobId: string | null;
};

export type AgentView = {
  enabled: boolean;
  autoDraft: boolean;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  /** "Data scientist in Berlin (25 km), Germany · via JSearch", or null without a search. */
  search: string | null;
  /** Why it can't run: no search, AI provider, source or key; null when it's set up. */
  setupProblem: string | null;
  /** Which settings section fixes it. */
  setupSection: "agent" | "ai" | "jobs" | null;
  /** The daily limit is used up. */
  limitReached: boolean;
  lastRun: { at: string; message: string | null } | null;
  /** In the user's zone; null while the agent is off. */
  nextRun: string | null;
  /** A run queued or running, to follow. */
  runJobId: string | null;
  drafts: AgentCandidateView[];
  /** At or above the minimum score, best first. */
  scored: AgentCandidateView[];
  /** Below it: kept so they don't come back, shown on request. */
  belowMinimum: AgentCandidateView[];
};

/** The Agent item's badge (E16-6): what's waiting for a look. */
export async function countAgentQueue(): Promise<number> {
  const { agentMinScore } = await loadSettings();
  return prisma.agentCandidate.count({
    where: {
      OR: [
        { status: AgentCandidateStatus.SCORED, score: { gte: agentMinScore } },
        { status: AgentCandidateStatus.DRAFTED, applicationId: { not: null } },
      ],
    },
  });
}

/** "Today" and "Yesterday" in a sentence; "2 days ago" or "15 Oct" as they are. */
const posted = (ago: string) => (ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago);

const sectionOf = (problem: string): AgentView["setupSection"] =>
  problem.includes("AI provider") ? "ai" : problem.includes("Job search") ? "jobs" : "agent";

export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const [settings, config, timeZone, candidates, draftJobs, runJobs] = await Promise.all([
    loadSettings(),
    loadJobSearchConfig(),
    lastKnownTimeZone(),
    prisma.agentCandidate.findMany({
      where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    }),
    prisma.job.findMany({
      where: { type: "agent-draft", status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
      select: { id: true, key: true },
    }),
    prisma.job.findMany({ where: { key: AGENT_JOB_KEY, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true }, take: 1 }),
  ]);
  const draftJob = new Map(draftJobs.map((job) => [job.key?.replace(/^agent-candidate:/, ""), job.id]));

  const query = settings.agentQuery;
  const source: JobSource | null = config.source;
  const search = query.keywords.trim()
    ? `${describeSearch(query, countryName(query.country) || query.country.toUpperCase())}${source ? ` · via ${SOURCE_INFO[source].name}` : ""}`
    : null;
  const setupProblem = await agentSetupProblem(query);

  const view = (candidate: (typeof candidates)[number]): AgentCandidateView => ({
    id: candidate.id,
    title: candidate.title.trim() || "Untitled posting",
    company: candidate.company.trim(),
    facts: [candidate.place, candidate.remote ? "Remote" : "", candidate.salary].filter(Boolean).join(" · "),
    origin: [
      candidate.postedAt ? `Posted ${posted(postedAgo(candidate.postedAt.toISOString(), now))}` : "",
      [candidate.via ? `via ${candidate.via}` : "", `on ${SOURCE_INFO[candidate.source].name}`].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(" · "),
    url: candidate.url,
    score: candidate.score,
    reasons: stringsOf(candidate.reasons),
    redFlags: stringsOf(candidate.redFlags),
    error: candidate.error,
    applicationId: candidate.applicationId,
    draftJobId: draftJob.get(candidate.id) ?? null,
  });
  const drafts = candidates.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId).map(view);
  const waiting = candidates.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTED);
  const last = settings.agentRuns[0];

  return {
    enabled: settings.agentEnabled,
    autoDraft: settings.agentAutoDraft,
    minScore: settings.agentMinScore,
    maxScores: settings.agentMaxScores,
    maxDrafts: settings.agentMaxDrafts,
    search,
    setupProblem,
    setupSection: setupProblem ? sectionOf(setupProblem) : null,
    limitReached: runsInPastDay(settings.agentRuns, now).length >= AGENT_MAX_RUNS_PER_DAY,
    lastRun: last ? { at: formatDateTime(new Date(last.at), timeZone, now), message: last.message } : null,
    nextRun: settings.agentEnabled ? formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns), timeZone, now) : null,
    runJobId: runJobs[0]?.id ?? null,
    drafts,
    scored: waiting.filter((candidate) => candidate.score >= settings.agentMinScore).map(view),
    belowMinimum: waiting.filter((candidate) => candidate.score < settings.agentMinScore).map(view),
  };
}
