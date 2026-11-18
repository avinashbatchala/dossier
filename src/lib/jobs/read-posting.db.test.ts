import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";
import { factorsAnswer } from "@/test/scoring";

import { READ_POSTING_STEPS } from "./application-steps";
import { readPostingJob } from "./read-posting";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
const provider = vi.hoisted(() => ({ current: undefined as unknown, calls: [] as string[] }));
vi.mock("@/lib/ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/ai")>()), getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
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
const context = (steps: string[] = []) => ({ id: "test-job", step: async (name: string) => void steps.push(name), signal: new AbortController().signal });

beforeEach(async () => {
  await resetDatabase(prisma());
  provider.calls = [];
  provider.current = new MockProvider({
    reply: (call) => {
      provider.calls.push(call.json?.name ?? "");
      if (call.json?.name === "extracted_posting") return extracted;
      return { ...factorsAnswer(call, "high"), requirements: [{ line: 0, kind: "must", covered: true, evidence: "Figma (skill)", skill: "Figma" }, { line: 1, kind: "nice", covered: false, evidence: "", skill: "Dutch" }] };
    },
  });
});
afterAll(() => prisma().$disconnect());

describe("readPostingJob (E7-2, E25-7)", () => {
  it("reads the posting, then scores it against the profile, whose requirements are How you match", async () => {
    const steps: string[] = [];
    const result = await readPostingJob.run({ posting: "- Strong prototyping skills in Figma\n- Dutch is a plus" }, context(steps));
    expect(steps).toEqual([...READ_POSTING_STEPS]);
    expect(provider.calls).toEqual(["extracted_posting", "posting_factors"]);
    expect(result).toMatchObject({
      extracted: { company: "Ledgerly", title: "Senior Product Designer · Ledgerly" },
      extractedWith: "extract-posting@3",
      match: {
        items: [
          { requirement: "Strong prototyping skills in Figma", result: "covered", note: "Figma (skill)", mustHave: true, addable: null },
          { requirement: "Dutch is a plus", result: "gap", note: null, mustHave: false, addable: "Dutch" },
        ],
      },
      matchedWith: "score-posting@3",
      fit: { score: expect.any(Number), breakdown: { requirements: expect.any(Array) } },
    });
  });

  it("reuses a Positions posting's score for that profile, with no call, and keeps a new one there", async () => {
    const scored = { source: "JSEARCH", externalId: "j1" };
    const fresh = await readPostingJob.run({ posting: "- Strong prototyping skills in Figma\n- Dutch is a plus", scored }, context());
    expect(await prisma().postingScore.findUniqueOrThrow({ where: { source_externalId_profileId: { ...scored, profileId: TEST_PROFILE_ID } } })).toMatchObject({ score: fresh.fit!.score });

    provider.calls = [];
    const again = await readPostingJob.run({ posting: "- Strong prototyping skills in Figma\n- Dutch is a plus", scored }, context());
    expect(provider.calls).toEqual(["extracted_posting"]);
    expect(again.match).toEqual(fresh.match);
  });

  it("reads the posting before the profile's levels are chosen, and only the comparison waits (#518)", async () => {
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { levelFrom: null, levelTo: null } });
    const reading = await readPostingJob.run({ posting: "Ledgerly is hiring." }, context());
    expect(provider.calls).toEqual(["extracted_posting"]);
    expect(reading.extracted).toBeTruthy();
    expect(reading.fit).toBeUndefined();
    expect(reading.match).toEqual({ items: [] });
    expect(reading.scoreWaits).toEqual({ message: "Set the levels for “My profile” first. Choose them in Profile → Jobs it's for.", href: `/profile?section=target&profile=${TEST_PROFILE_ID}` });
  });
});
