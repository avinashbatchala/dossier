import type { Metadata } from "next";

import { loadAgentView } from "@/lib/agent/view";

import { AgentScreen } from "./agent-screen";
import { AGENT_TABS, type AgentTab } from "./tabs";

export const metadata: Metadata = { title: "Job agent" };

/** The job agent (E16-6): what it found and the drafts it prepared, waiting for a look. */
export default async function AgentPage({ searchParams }: PageProps<"/agent">) {
  const { tab } = await searchParams;
  // The tab is in the URL (E32-5): Drafts to review, Best finds or Skipped.
  const shown = AGENT_TABS.find((key) => key === tab) as AgentTab | undefined;
  return <AgentScreen view={await loadAgentView()} tab={shown ?? "drafts"} />;
}
