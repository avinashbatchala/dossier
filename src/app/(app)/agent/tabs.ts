// The Agent screen's tabs (E32-5, PL3), shared by the page and the screen.
// Not in the screen's "use client" module: the page reads them on the server.

export const AGENT_TABS = ["drafts", "finds", "skipped"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];
