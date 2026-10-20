import { describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { demoProfile } from "@/lib/demo-profile";

import { READ_POSTING_STEPS } from "./application-steps";
import { readPostingJob } from "./read-posting";

const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const extracted = {
  title: null,
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: null,
  salary: null,
  deadline: "2026-10-15",
  requirements: [{ text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null }],
  asksForReferences: false,
  language: "English",
};

describe("readPostingJob (E7-2)", () => {
  it("reads the posting, then compares it with the profile, naming each step", async () => {
    provider.current = new MockProvider({
      reply: (call) => (call.json?.name === "extracted_posting" ? extracted : { matches: [{ requirement: 0, skill: "Figma", language: null }] }),
    });
    const steps: string[] = [];
    const result = await readPostingJob.run({ posting: "Ledgerly is hiring…" }, { id: "test-job", step: async (name) => void steps.push(name), signal: new AbortController().signal });
    expect(steps).toEqual([...READ_POSTING_STEPS]);
    expect(result).toMatchObject({
      extracted: { company: "Ledgerly", title: "Senior Product Designer · Ledgerly" },
      extractedWith: "extract-posting@1",
      match: { items: [{ requirement: "Strong prototyping skills in Figma", result: "covered", experienceIds: ["e2"] }] },
      matchedWith: "match-requirements@1",
    });
    expect(demoProfile().experience[1].id).toBe("e2");
  });
});
