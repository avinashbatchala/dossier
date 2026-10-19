import "server-only";

import { z } from "zod";

import { defineJob } from "@/lib/jobs/runner";

import { agentScanResultSchema, draftCandidate, runAgentScan } from "./run";

/** Searches, scores, and optionally drafts; one source request per run (E16). */
export const agentScanJob = defineJob({
  type: "agent-scan",
  input: z.object({ manual: z.boolean().default(false) }),
  result: agentScanResultSchema,
  run: (input, context) => runAgentScan(input, context),
});

/** Prepares one draft from a candidate the user chose, in the background. */
export const agentDraftJob = defineJob({
  type: "agent-draft",
  input: z.object({ candidateId: z.string().min(1) }),
  result: z.object({ applicationId: z.string().min(1) }),
  async run({ candidateId }, context) {
    return { applicationId: await draftCandidate(candidateId, context) };
  },
});
