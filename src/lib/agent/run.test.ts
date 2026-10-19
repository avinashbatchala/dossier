import { describe, expect, it } from "vitest";

import { agentFingerprint } from "./run";
import { nextAgentRun } from "./schedule";

const posting = {
  source: "JSEARCH" as const,
  externalId: "job-1",
  url: "https://jobs.example/roles/designer?utm_source=linkedin",
  title: "Senior Product Designer",
  company: "Ledgerly",
  place: "Amsterdam",
};

describe("agentFingerprint", () => {
  it("identifies the same page across sources, ignoring tracking parameters", () => {
    expect(agentFingerprint(posting)).toBe(
      agentFingerprint({ ...posting, source: "ADZUNA", externalId: "other", url: "https://jobs.example/roles/designer?ref=adzuna" }),
    );
  });

  it("falls back to company, title and place when there is no link", () => {
    expect(agentFingerprint({ ...posting, url: "" })).toBe(
      agentFingerprint({ ...posting, source: "ARBEITSAGENTUR", externalId: "x", url: "", company: "  LEDGERLY ", title: "senior product designer" }),
    );
    expect(agentFingerprint({ ...posting, url: "", title: "Product Designer" })).not.toBe(agentFingerprint({ ...posting, url: "" }));
  });
});

describe("nextAgentRun", () => {
  it("uses today's hour when it is still ahead", () => {
    expect(nextAgentRun(new Date(2026, 9, 19, 6, 30), 7)).toEqual(new Date(2026, 9, 19, 7, 0));
  });

  it("moves to tomorrow once the hour has passed", () => {
    expect(nextAgentRun(new Date(2026, 9, 19, 8, 0), 7)).toEqual(new Date(2026, 9, 20, 7, 0));
  });
});
