import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import type { AgentCandidate } from "@/generated/prisma/client";
import { AiError } from "@/lib/ai";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { isAiConfigured } from "@/lib/ai/config";
import { scorePosting } from "@/lib/ai/tasks";
import { ActionError } from "@/lib/action";
import { createApplicationFromDocuments } from "@/lib/application-create";
import { fullText } from "@/lib/job-search/find";
import { credentialsFor, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { searchPostings } from "@/lib/job-search";
import { linkKey, type FoundPosting, type SearchQuery } from "@/lib/job-search/search";
import { logServerError } from "@/lib/log";
import { postingStates, storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import type { JobContext } from "@/lib/jobs/runner";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";

// The job agent (E16): one search at a time, a cheap score for every new
// posting, and tailored drafts only for the best few. The app is single-user
// and single-instance, so a plain in-process job is enough.

/** One source request per run, and at most this many runs in any 24 hours. */
export const AGENT_MAX_RUNS_PER_DAY = 3;
/** A manual run waits this long after the previous run, whichever kind it was. */
export const AGENT_MANUAL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const agentScanResultSchema = z.object({
  found: z.number().int().min(0),
  fresh: z.number().int().min(0),
  scored: z.number().int().min(0),
  drafted: z.number().int().min(0),
  skipped: z.number().int().min(0),
  message: z.string().nullable(),
});
export type AgentScanResult = z.infer<typeof agentScanResultSchema>;

/** A stable, index-sized key for dedupe across sources and runs. */
export function agentFingerprint(posting: Pick<FoundPosting, "source" | "externalId" | "url" | "title" | "company" | "place">): string {
  const link = linkKey(posting.url);
  const normal = (value: string) =>
    value
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const basis = link || `job:${normal(posting.company)}|${normal(posting.title)}|${normal(posting.place)}`;
  const stable = basis === "job:||" ? `${posting.source}:${posting.externalId}` : basis;
  return `agent:${createHash("sha256").update(stable).digest("hex")}`;
}

const skipped = (message: string): AgentScanResult => ({ found: 0, fresh: 0, scored: 0, drafted: 0, skipped: 0, message });

/** The postings text for a score: the snippet the source gave, with its facts. */
function textForScore(posting: FoundPosting): string {
  return [posting.title, posting.company, posting.place, posting.remote === true ? "Remote" : "", posting.salary, posting.description]
    .filter(Boolean)
    .join("\n");
}

/** The details New application and the agent both use, from what was read. */
function detailsFrom(extracted: {
  title: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  mode: string | null;
  salary: string | null;
  deadline: string | null;
}) {
  return {
    title: extracted.title ?? [extracted.role, extracted.company].filter(Boolean).join(" · "),
    company: extracted.company ?? "",
    role: extracted.role ?? "",
    location: extracted.location ?? "",
    mode: extracted.mode ?? "",
    salary: extracted.salary ?? "",
    deadline: extracted.deadline ?? "",
  };
}

function foundFromCandidate(candidate: AgentCandidate): FoundPosting {
  return {
    source: candidate.source,
    externalId: candidate.externalId,
    title: candidate.title,
    company: candidate.company,
    place: candidate.place,
    remote: candidate.remote,
    salary: candidate.salary,
    postedAt: candidate.postedAt?.toISOString() ?? null,
    url: candidate.url,
    via: candidate.via,
    description: candidate.description,
    complete: candidate.complete,
  };
}

/**
 * One agent run: search the first page only (one source request), skip what
 * was seen before, score the newest candidates, and optionally draft the best.
 * It never sends anything; drafts stay Draft applications.
 */
export async function runAgentScan({ manual }: { manual: boolean }, context: JobContext): Promise<AgentScanResult> {
  const runId = context.id ?? "agent-direct";
  const settings = await loadSettings();
  if (!settings.agentEnabled && !manual) return skipped("The job agent is off.");
  const query = settings.agentQuery;
  if (!query.keywords.trim()) return skipped("Add keywords in Settings → Job agent first.");
  if (!query.country) return skipped("Choose a country in Settings → Job agent first.");

  const now = new Date();
  const runs = await prisma.job.count({
    where: { type: "agent-scan", id: { not: runId }, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  if (runs >= AGENT_MAX_RUNS_PER_DAY) {
    return skipped(`The agent has run ${AGENT_MAX_RUNS_PER_DAY} times in the past day. It will run again tomorrow.`);
  }

  if (!(await isAiConfigured())) return skipped("Choose an AI provider in Settings → AI provider first.");
  const config = await loadJobSearchConfig();
  const source = config.source;
  if (!source) return skipped("Choose a job source in Settings → Job search first.");

  // Count the run before asking the source, so a crash can't lead to a retry
  // loop that spends the quota twice.
  await saveSettings({ agentLastRunAt: now.toISOString() });
  await context.step("Searching for new postings");

  let page;
  try {
    page = await searchPostings(source, credentialsFor(config, source), query, null, requestContext(source));
  } catch (error) {
    if (error instanceof JobSearchError) return skipped(error.message);
    throw error;
  }

  const found = page.postings.length;
  const states = await postingStates(page.postings);
  const fresh = page.postings.filter((posting) => {
    const state = states.get(`${posting.source}:${posting.externalId}`);
    return !state?.saved && !state?.dismissed && !state?.applicationId;
  });

  const existing = await prisma.agentCandidate.findMany({
    where: {
      OR: [
        { source, externalId: { in: fresh.map((posting) => posting.externalId) } },
        { dedupeKey: { in: fresh.map(agentFingerprint) } },
      ],
    },
    select: { source: true, externalId: true, dedupeKey: true },
  });
  const seen = new Set(existing.flatMap((candidate) => [`${candidate.source}:${candidate.externalId}`, candidate.dedupeKey]));
  const newPostings = fresh.filter(
    (posting) => !seen.has(`${posting.source}:${posting.externalId}`) && !seen.has(agentFingerprint(posting)),
  );

  if (newPostings.length === 0) {
    return { found, fresh: 0, scored: 0, drafted: 0, skipped: found, message: "No new postings this time." };
  }

  const toScore = [...newPostings]
    .sort((a, b) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0))
    .slice(0, settings.agentMaxScores);

  await context.step(`Scoring ${toScore.length} ${toScore.length === 1 ? "posting" : "postings"}`);
  const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
  let scored = 0;
  let lastProblem: string | null = null;
  for (const posting of toScore) {
    if (context.signal.aborted) break;
    try {
      const result = await scorePosting(
        provider,
        {
          posting: textForScore(posting),
          profile,
          title: posting.title,
          company: posting.company,
          place: posting.place,
          remote: posting.remote,
          salary: posting.salary,
        },
        { ...options, signal: context.signal },
      );
      await prisma.agentCandidate
        .create({
          data: {
            jobId: runId,
            source: posting.source,
            externalId: posting.externalId,
            title: posting.title,
            company: posting.company,
            place: posting.place,
            remote: posting.remote,
            salary: posting.salary,
            postedAt: posting.postedAt ? new Date(posting.postedAt) : null,
            url: posting.url,
            via: posting.via,
            description: posting.description,
            complete: posting.complete,
            score: result.data.score,
            reasons: result.data.reasons,
            redFlags: result.data.redFlags,
            dedupeKey: agentFingerprint(posting),
          },
        })
        .then(() => {
          scored += 1;
        })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === "P2002") return;
          throw error;
        });
    } catch (error) {
      if (error instanceof AiError) lastProblem = error.message;
      else logServerError("agent scoring", error);
    }
  }

  let drafted = 0;
  if (settings.agentAutoDraft && settings.agentMaxDrafts > 0) {
    const best = await prisma.agentCandidate.findMany({
      where: { jobId: runId, status: AgentCandidateStatus.SCORED, score: { gte: settings.agentMinScore } },
      orderBy: { score: "desc" },
      take: settings.agentMaxDrafts,
      select: { id: true, company: true, title: true },
    });
    for (const candidate of best) {
      if (context.signal.aborted) break;
      await context.step(`Preparing a draft for ${candidate.company || candidate.title || "a posting"}`);
      try {
        await draftCandidate(candidate.id, context);
        drafted += 1;
      } catch (error) {
        if (error instanceof AiError || error instanceof ActionError) lastProblem = error.message;
        else logServerError("agent draft", error);
      }
    }
  }

  const message =
    drafted > 0
      ? `${drafted} ${drafted === 1 ? "draft is" : "drafts are"} ready for your review.`
      : scored > 0
        ? "Postings scored. Prepare a draft when you're ready."
        : (lastProblem ?? "No postings could be scored this time.");
  return { found, fresh: newPostings.length, scored, drafted, skipped: found - newPostings.length, message };
}

/**
 * Prepare one draft from a scored candidate. The candidate is claimed first,
 * so a retry or a second click can't make two applications.
 */
export async function draftCandidate(candidateId: string, context: JobContext): Promise<string> {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new ActionError("That posting is no longer in the queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return candidate.applicationId;
  if (candidate.status === AgentCandidateStatus.DISMISSED || candidate.status === AgentCandidateStatus.APPROVED) {
    throw new ActionError("That posting is no longer waiting for a draft.");
  }

  const claimed = await prisma.agentCandidate.updateMany({
    where: { id: candidateId, status: AgentCandidateStatus.SCORED },
    data: { status: AgentCandidateStatus.DRAFTING, error: null },
  });
  if (claimed.count === 0) {
    const current = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
    if (current?.status === AgentCandidateStatus.DRAFTED && current.applicationId) return current.applicationId;
    throw new ActionError("That draft is already being prepared.");
  }

  const settings = await loadSettings();
  const jobId = context.id ?? "agent-direct";
  try {
    const found = foundFromCandidate(candidate);
    const text = (await fullText(found)) ?? candidate.description;
    if (!text.trim()) throw new ActionError("That posting has no text to write from. Open it and start an application by hand.");

    await context.step(`Reading ${candidate.company || candidate.title || "the posting"}`);
    const reading = await readPostingJob.run({ posting: text }, context);

    await context.step(`Writing a draft for ${candidate.company || candidate.title || "the posting"}`);
    const documents = await writeDocumentsJob.run(
      {
        readJobId: jobId,
        posting: text,
        extracted: reading.extracted,
        match: reading.match,
        tone: settings.defaultTone,
        note: "",
      },
      context,
    );

    const posting = await storePosting({ ...found, description: text, complete: true });
    return await createApplicationFromDocuments({
      reading: { input: { posting: text }, result: reading },
      documents,
      details: detailsFrom(reading.extracted),
      postingUrl: candidate.url,
      postingId: posting.id,
      tone: settings.defaultTone,
      note: "",
      claim: { kind: "agent", candidateId, jobId, score: candidate.score },
    });
  } catch (error) {
    const message =
      error instanceof AiError || error instanceof ActionError
        ? error.message
        : "The draft couldn't be prepared. Try again from the agent queue.";
    await prisma.agentCandidate.updateMany({
      where: { id: candidateId, status: AgentCandidateStatus.DRAFTING },
      data: { status: AgentCandidateStatus.SCORED, error: message },
    });
    if (!(error instanceof AiError) && !(error instanceof ActionError)) logServerError("agent draft", error);
    throw error;
  }
}

/** After a restart, a candidate left DRAFTING has no job and would be stuck. */
export async function resetStuckAgentCandidates(): Promise<number> {
  const { count } = await prisma.agentCandidate.updateMany({
    where: { status: AgentCandidateStatus.DRAFTING },
    data: { status: AgentCandidateStatus.SCORED, error: "Drafting was interrupted. Try again." },
  });
  return count;
}

/** A manual run is allowed at most hourly, so a click can't spend the source quota. */
export async function manualRunProblem(now = new Date()): Promise<string | null> {
  const settings = await loadSettings();
  if (!settings.agentLastRunAt) return null;
  const last = new Date(settings.agentLastRunAt);
  if (Number.isNaN(last.getTime())) return null;
  const wait = AGENT_MANUAL_INTERVAL_MS - (now.getTime() - last.getTime());
  if (wait <= 0) return null;
  const minutes = Math.ceil(wait / 60_000);
  return `The agent ran recently. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/** The first page's next token is ignored on purpose: the agent never spends a second request. */
export function agentQueryIsReady(query: SearchQuery): boolean {
  return Boolean(query.keywords.trim() && query.country);
}
