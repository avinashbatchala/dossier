import "server-only";

import { z } from "zod";

import { defineJob } from "@/lib/jobs/runner";

import { agentScanResultSchema, runAgentScan } from "./run";

/** Keyed so the schedule and Run now find a run that's queued or running. */
export const AGENT_JOB_KEY = "agent";

/** One run of the job agent (E16-3): one search, then scores; one source request at most. */
export const agentScanJob = defineJob({
  type: "agent-scan",
  input: z.object({ manual: z.boolean() }),
  result: agentScanResultSchema,
  run: (input, context) => runAgentScan(input, context),
});
