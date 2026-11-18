"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { agentDraftJob, approveCandidate, dismissCandidate, draftJobKey, restoreCandidate } from "@/lib/agent/draft";
import { AGENT_JOB_KEY, agentScanJob } from "@/lib/agent/jobs";
import { agentSetupProblem, agentSlots } from "@/lib/agent/run";
import { runLimitProblem } from "@/lib/agent/runs";
import { agentSearchInputSchema, agentSearchSetupProblem } from "@/lib/agent/search";
import { deleteAgentSearch, listAgentSearches, moveAgentSearch, saveAgentSearch, setAgentSearchEnabled } from "@/lib/agent/searches";
import { action, ActionError } from "@/lib/action";
import { safeLink } from "@/lib/job-search/search";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { COVERS } from "@/lib/posting-coverage";

// The Agent screen's actions (E16). Nothing here ever sends anything:
// approving only makes a draft a normal Draft application.

/**
 * Shared settings save at once. Search edits use the collection actions below.
 */
export const saveAgentSettings = action(
  z.object({
    enabled: z.boolean().optional(),
    hour: z.number().int().min(0).max(23).optional(),
    /** The queue's cut-off (E32-2). */
    covers: z.enum(COVERS).optional(),
    maxScores: z.number().int().min(1).max(30).optional(),
    maxDrafts: z.number().int().min(0).max(10).optional(),
    autoDraft: z.boolean().optional(),
  }).strict(),
  async (changes) => {
    if (changes.enabled) {
      const problem = agentSearchSetupProblem(await listAgentSearches());
      if (problem) throw new ActionError(problem);
    }
    await saveSettings({
      agentEnabled: changes.enabled,
      agentHour: changes.hour,
      agentCovers: changes.covers,
      agentMaxScores: changes.maxScores,
      agentMaxDrafts: changes.maxDrafts,
      agentAutoDraft: changes.autoDraft,
    });
    revalidatePath("/agent");
    revalidatePath("/settings");
    return null;
  },
);

const searchId = z.string().min(1).max(100);
export const setRecurringSearchEnabled = action(z.object({ id: searchId, enabled: z.boolean() }).strict(), async ({ id, enabled }) => {
  const search = await setAgentSearchEnabled(id, enabled);
  revalidatePath("/agent");
  revalidatePath("/settings");
  return search;
});
export const saveRecurringSearch = action(
  agentSearchInputSchema.extend({ id: searchId.optional() }).strict(),
  async ({ id, ...input }) => {
    if (input.enabled && !input.query.country) throw new ActionError(`Choose a country for “${input.name}”.`);
    const search = await saveAgentSearch(input, id);
    revalidatePath("/agent");
    revalidatePath("/settings");
    return search;
  },
);
export const deleteRecurringSearch = action(z.object({ id: searchId }).strict(), async ({ id }) => {
  await deleteAgentSearch(id);
  revalidatePath("/agent");
  revalidatePath("/settings");
  return null;
});
export const moveRecurringSearch = action(z.object({ id: searchId, direction: z.enum(["up", "down"]) }).strict(), async ({ id, direction }) => {
  await moveAgentSearch(id, direction);
  revalidatePath("/agent");
  revalidatePath("/settings");
  return listAgentSearches();
});

/**
 * Run all now: at most once an hour after the previous run and only when
 * the whole enabled batch fits the rolling request quota. An unfinished job is
 * reused rather than started again.
 */
export const runAgentNow = action(z.object({}), async () => {
  const settings = await loadSettings();
  if (!settings.agentEnabled) throw new ActionError("Turn the job agent on in Settings → Job agent first.");
  const setup = await agentSetupProblem();
  if (setup) throw new ActionError(setup);
  const [unfinished] = await findUnfinishedJobs(AGENT_JOB_KEY);
  if (unfinished) return { jobId: unfinished.id, reused: true };
  const limit = runLimitProblem(settings.agentRuns, new Date(), { manual: true, slots: await agentSlots(), timeZone: await lastKnownTimeZone() });
  if (limit) throw new ActionError(limit);
  const jobId = await startJob(agentScanJob, { manual: true }, { key: AGENT_JOB_KEY });
  revalidatePath("/agent");
  return { jobId, reused: false };
});

const candidateId = z.string().min(1).max(100);

/** Every screen an agent draft shows on, or leaves. */
function revalidateAgent() {
  revalidatePath("/agent");
  revalidatePath("/applications");
  revalidatePath("/jobs");
  revalidatePath("/");
}

/**
 * Prepare draft (E16-5): writes a candidate's draft in the background. A
 * draft under way is reused, and one already made is answered with.
 */
export const prepareAgentDraft = action(z.object({ candidateId }), async ({ candidateId }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate) throw new ActionError("That posting is no longer in the agent's queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return { jobId: null, applicationId: candidate.applicationId };
  const [unfinished] = await findUnfinishedJobs(draftJobKey(candidateId));
  if (unfinished) return { jobId: unfinished.id, applicationId: null };
  if (candidate.status !== AgentCandidateStatus.SCORED) throw new ActionError("That posting is no longer waiting for a draft.");
  const jobId = await startJob(agentDraftJob, { candidateId, auto: false }, { key: draftJobKey(candidateId) });
  revalidatePath("/agent");
  return { jobId, applicationId: null };
});

/** Approve (E16-5): the draft joins Applications as a Draft. Nothing is sent. */
export const approveAgentDraft = action(z.object({ candidateId }), async ({ candidateId }, { toast }) => {
  const applicationId = await approveCandidate(candidateId);
  revalidateAgent();
  toast("Added to Applications as a draft. Nothing has been sent.");
  return { applicationId };
});

/**
 * Dismiss (E16-5): the posting never comes back; its draft, if any, is
 * deleted. A posting dismissed before it had a draft can be put back.
 */
export const dismissAgentCandidate = action(z.object({ candidateId }), async ({ candidateId }) => {
  const { undo } = await dismissCandidate(candidateId);
  revalidateAgent();
  return { undo };
});

/** Undo on a dismissed posting's toast. */
export const restoreAgentCandidate = action(
  z.object({
    id: candidateId,
    place: z.string().max(500),
    remote: z.boolean().nullable(),
    salary: z.string().max(500),
    postedAt: z.coerce.date().nullable(),
    // Shown as a link again: only a web address.
    url: z.string().max(4000).transform(safeLink),
    via: z.string().max(500),
    description: z.string().max(200_000),
    complete: z.boolean(),
    reasons: z.array(z.string().max(500)).max(10).nullable(),
    redFlags: z.array(z.string().max(500)).max(10).nullable(),
  }),
  async (saved) => {
    await restoreCandidate(saved);
    revalidateAgent();
    return null;
  },
);
