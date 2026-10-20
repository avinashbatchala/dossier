import type { Metadata } from "next";

import { loadAgentView } from "@/lib/agent/view";

import { AgentScreen } from "./agent-screen";

export const metadata: Metadata = { title: "Job agent" };

/** The job agent (E16-6): what it found and the drafts it prepared, waiting for a look. */
export default async function AgentPage() {
  return <AgentScreen view={await loadAgentView()} />;
}
