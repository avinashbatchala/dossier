import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { AgentCandidateStatus, type PostingSource } from "@/generated/prisma/enums";
import { formatDateTime, formatShortDate } from "@/lib/dates";
import { describeSearch, type JobSource, type SearchQuery } from "@/lib/job-search/search";
import { countryName } from "@/lib/job-search/countries";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { findLatestJob, type JobView } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import type { SettingsData } from "@/lib/settings";import { userTimeZone } from "@/lib/time-zone";

import { nextAgentRun } from "./schedule";
import type { AgentScanResult } from "./run";

export type AgentCandidateView = {
  id: string;
  source: PostingSource;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  posted: string | null;
  url: string;
  via: string;
  description: string;
  complete: boolean;
  score: number;
  reasons: string[];
  redFlags: string[];
  status: AgentCandidateStatus;
  error: string | null;
  applicationId: string | null;
};

export type AgentView = {
  enabled: boolean;
  source: JobSource | null;
  query: SearchQuery;
  searchLine: string;
  hour: number;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  autoDraft: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  nextRunLabel: string | null;
  job: JobView<AgentScanResult> | null;
  queue: AgentCandidateView[];
  counts: { scored: number; drafting: number; drafted: number; waiting: number };
};

function strings(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function candidateView(candidate: {
  id: string;
  source: PostingSource;
  title: string;
  company: string;
  place: string;
  remote: boolean | null;
  salary: string;
  postedAt: Date | null;
  url: string;
  via: string;
  description: string;
  complete: boolean;
  score: number;
  reasons: Prisma.JsonValue;
  redFlags: Prisma.JsonValue;
  status: AgentCandidateStatus;
  error: string | null;
  applicationId: string | null;
}): AgentCandidateView {
  return {
    id: candidate.id,
    source: candidate.source,
    title: candidate.title,
    company: candidate.company,
    place: candidate.place,
    remote: candidate.remote,
    salary: candidate.salary,
    posted: candidate.postedAt ? formatShortDate(candidate.postedAt) : null,
    url: candidate.url,
    via: candidate.via,
    description: candidate.description,
    complete: candidate.complete,
    score: candidate.score,
    reasons: strings(candidate.reasons),
    redFlags: strings(candidate.redFlags),
    status: candidate.status,
    error: candidate.error,
    applicationId: candidate.applicationId,
  };
}

/** A run after today's has already happened starts again tomorrow. */
function nextRunAt(settings: SettingsData, now: Date): string | null {
  if (!settings.agentEnabled) return null;
  let next = nextAgentRun(now, settings.agentHour);
  if (settings.agentLastRunAt) {
    const last = new Date(settings.agentLastRunAt);
    if (!Number.isNaN(last.getTime()) && last.toDateString() === now.toDateString() && next.toDateString() === now.toDateString()) {
      next = nextAgentRun(new Date(now.getTime() + 24 * 60 * 60 * 1000), settings.agentHour);
    }
  }
  return next.toISOString();
}

/** Everything the Agent screen needs. */
export async function loadAgentView(now = new Date()): Promise<AgentView> {
  const [settings, config, job, queue, timeZone] = await Promise.all([
    loadSettings(),
    loadJobSearchConfig(),
    findLatestJob("agent"),
    prisma.agentCandidate.findMany({
      where: { status: { in: [AgentCandidateStatus.SCORED, AgentCandidateStatus.DRAFTING, AgentCandidateStatus.DRAFTED] } },
      orderBy: [{ status: "desc" }, { score: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    userTimeZone(),
  ]);
  const counts = {
    scored: queue.filter((candidate) => candidate.status === AgentCandidateStatus.SCORED).length,
    drafting: queue.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTING).length,
    drafted: queue.filter((candidate) => candidate.status === AgentCandidateStatus.DRAFTED).length,
    waiting: queue.filter((candidate) => candidate.status !== AgentCandidateStatus.DRAFTING).length,
  };
  const source = config.source;
  const searchLine = describeSearch(settings.agentQuery, countryName(settings.agentQuery.country) || settings.agentQuery.country.toUpperCase());
  const nextRun = nextRunAt(settings, now);
  return {
    enabled: settings.agentEnabled,
    source,
    query: settings.agentQuery,
    searchLine,
    hour: settings.agentHour,
    minScore: settings.agentMinScore,
    maxScores: settings.agentMaxScores,
    maxDrafts: settings.agentMaxDrafts,
    autoDraft: settings.agentAutoDraft,
    lastRunAt: settings.agentLastRunAt ? formatDateTime(new Date(settings.agentLastRunAt), timeZone) : null,
    nextRunAt: nextRun,
    nextRunLabel: nextRun ? formatDateTime(new Date(nextRun), timeZone) : null,
    job: job as JobView<AgentScanResult> | null,
    queue: queue.map(candidateView),
    counts,
  };
}
