import type { Metadata } from "next";

import { loadAgentView } from "@/lib/agent/data";

import { AgentScreen } from "./agent-screen";

export const metadata: Metadata = { title: "Job agent" };

/** The job agent: one search, a queue of scored postings and prepared drafts (E16). */
export default async function AgentPage() {
  return <AgentScreen view={await loadAgentView()} />;
}
