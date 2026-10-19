"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AgentCandidateStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { credentialsFor, loadJobSearchConfig } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { searchQuerySchema } from "@/lib/job-search/search";
import { cancelJob, findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { agentDraftJob, agentScanJob } from "./jobs";
import { manualRunProblem } from "./run";

// Settings → Job agent and the Agent screen (E16). A run is always a
// background job; the screen follows it like any other job. Approving only
// makes a draft a normal application: nothing is ever sent from here.

const settingsSchema = z.object({
  enabled: z.boolean(),
  query: searchQuerySchema,
  hour: z.number().int().min(0).max(23),
  minScore: z.number().int().min(0).max(100),
  maxScores: z.number().int().min(1).max(30),
  maxDrafts: z.number().int().min(0).max(10),
  autoDraft: z.boolean(),
});

/** Saves the one agent search and its limits. */
export const saveAgentSettings = action(settingsSchema, async (input, { toast }) => {
  if (input.enabled && !input.query.keywords.trim()) throw new ActionError("Type what the agent should look for before turning it on.");
  if (input.enabled && !input.query.country) throw new ActionError("Choose a country for the agent search before turning it on.");
  await saveSettings({
    agentEnabled: input.enabled,
    agentQuery: { ...input.query, keywords: input.query.keywords.trim(), place: input.query.place.trim() },
    agentHour: input.hour,
    agentMinScore: input.minScore,
    agentMaxScores: input.maxScores,
    agentMaxDrafts: input.maxDrafts,
    agentAutoDraft: input.autoDraft,
  });
  toast(input.enabled ? "Job agent saved. It will run once a day." : "Job agent saved, and paused.");
  revalidatePath("/agent");
  revalidatePath("/settings");
  return null;
});

/** "Run now": one extra run, within the hourly and daily limits. */
export const runAgentNow = action(z.object({}), async () => {
  const settings = await loadSettings();
  if (!settings.agentEnabled) throw new ActionError("Turn the job agent on first.");
  if (!settings.agentQuery.keywords.trim() || !settings.agentQuery.country) {
    throw new ActionError("Finish the agent search in Settings → Job agent first.");
  }
  const problem = await manualRunProblem();
  if (problem) throw new ActionError(problem);

  const [unfinished] = await findUnfinishedJobs("agent");
  if (unfinished) return { jobId: unfinished.id, reused: true };

  if (!(await isAiConfigured())) throw new ActionError("Choose an AI provider in Settings → AI provider first.");
  const config = await loadJobSearchConfig();
  if (!config.source) throw new ActionError("Choose a job source in Settings → Job search first.");
  try {
    credentialsFor(config, config.source);
  } catch (error) {
    throw new ActionError(error instanceof JobSearchError ? error.message : "The job source isn't ready.");
  }

  const jobId = await startJob(agentScanJob, { manual: true }, { key: "agent" });
  revalidatePath("/agent");
  return { jobId, reused: false };
});

/** "Prepare draft": writes one candidate's documents in the background. */
export const prepareAgentDraft = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) throw new ActionError("That posting is no longer in the queue.");
  if (candidate.status === AgentCandidateStatus.DRAFTED && candidate.applicationId) return { jobId: null, applicationId: candidate.applicationId };
  if (candidate.status === AgentCandidateStatus.DRAFTING) throw new ActionError("That draft is already being prepared.");
  if (candidate.status !== AgentCandidateStatus.SCORED) throw new ActionError("That posting is no longer waiting for a draft.");

  const key = `agent-candidate:${candidateId}`;
  const [unfinished] = await findUnfinishedJobs(key);
  if (unfinished) return { jobId: unfinished.id, applicationId: null };

  const jobId = await startJob(agentDraftJob, { candidateId }, { key });
  revalidatePath("/agent");
  return { jobId, applicationId: null };
});

/** "Approve": keeps the draft as a normal application. It still isn't sent. */
export const approveAgentCandidate = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }, { toast }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate || candidate.status !== AgentCandidateStatus.DRAFTED || !candidate.applicationId) {
    throw new ActionError("That draft isn't ready to approve yet.");
  }
  await prisma.agentCandidate.update({ where: { id: candidateId }, data: { status: AgentCandidateStatus.APPROVED } });
  toast("Draft added to Applications. Review it there before you send.");
  revalidatePath("/agent");
  revalidatePath("/applications");
  revalidatePath("/");
  return { applicationId: candidate.applicationId };
});

/** "Dismiss": removes the draft and keeps the posting out of future runs. */
export const dismissAgentCandidate = action(z.object({ candidateId: z.string().min(1) }), async ({ candidateId }, { toast }) => {
  const candidate = await prisma.agentCandidate.findUnique({ where: { id: candidateId }, select: { status: true, applicationId: true } });
  if (!candidate) throw new ActionError("That posting is no longer in the queue.");

  if (candidate.status === AgentCandidateStatus.DRAFTING) {
    const [unfinished] = await findUnfinishedJobs(`agent-candidate:${candidateId}`);
    if (unfinished) await cancelJob(unfinished.id);
  }

  await prisma.$transaction(async (tx) => {
    if (candidate.applicationId) {
      const posting = await tx.posting.findFirst({ where: { applicationId: candidate.applicationId }, select: { id: true } });
      if (posting) await tx.posting.update({ where: { id: posting.id }, data: { dismissedAt: new Date(), savedAt: null } });
      // Its documents, chat and notes go with it. The candidate keeps the
      // posting's details so it never comes back.
      await tx.application.deleteMany({ where: { id: candidate.applicationId } });
    }
    await tx.agentCandidate.update({
      where: { id: candidateId },
      data: { status: AgentCandidateStatus.DISMISSED, applicationId: null, error: null },
    });
  });
  toast("Dismissed. It won't be suggested again.");
  revalidatePath("/agent");
  revalidatePath("/applications");
  revalidatePath("/");
  return null;
});
