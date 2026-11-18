import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";
import { factorsAnswer } from "@/test/scoring";

import { MockProvider } from "../ai/providers/mock";

import { scoreStartupJob } from "./score-startup";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
// Settings → Scoring reads DOSSIER_SCORER, and the AI model scores until Jev is chosen (#274).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
const fake = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
        fake.sent.push(call.messages[0].content);
        return factorsAnswer(call, "mid");
      },
    }),
}));

const prisma = () => db.client!;
const context = () => {
  const steps: string[] = [];
  return { id: "score-job", steps, step: async (name: string) => void steps.push(name), signal: new AbortController().signal };
};
const startup = () =>
  prisma().startup.create({
    data: {
      source: "HN",
      externalId: "1",
      company: "Acme",
      summary: "Android apps for farmers",
      details: "Acme | Android Engineer | Berlin\nKotlin, Android. Write to jobs@acme.io.",
      location: "Berlin, Germany",
      roles: ["Android Engineer"],
      emails: [],
      links: [],
      score: 40,
      reasons: ["Your skills: Android"],
      scoredWith: "match@1",
    },
  });

beforeEach(async () => {
  await resetDatabase(prisma());
  fake.sent = [];
});
afterAll(() => prisma().$disconnect());

describe("Score on a startup (#524)", () => {
  it("scores the post, without its addresses, and its score replaces the keyword match", async () => {
    const { id } = await startup();
    const run = context();
    expect(await scoreStartupJob.run({ id }, run)).toEqual({ score: 71, profileId: TEST_PROFILE_ID });
    expect(run.steps).toEqual(["Scoring it against your profile"]);
    expect(fake.sent[0]).toContain("Kotlin, Android.");
    expect(fake.sent[0]).not.toContain("jobs@acme.io");
    const row = await prisma().startup.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ score: 71, scoredWith: "score-posting@3", profileId: TEST_PROFILE_ID });
    expect(row.reasons).toContainEqual({ text: "Work experience 17/25: Work: mid.", good: true });
  });

  it("scores against all profiles whose levels are chosen and keeps the best", async () => {
    const { id } = await startup();
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    await prisma().profile.create({ data: { name: "Research", sort: 2 } });
    const run = context();
    await scoreStartupJob.run({ id, profiles: "all" }, run);
    expect(run.steps).toEqual(["Scoring it against “My profile”", "Scoring it against “Backend”"]);
    // A tie keeps the first.
    expect((await prisma().startup.findUniqueOrThrow({ where: { id } })).profileId).toBe(TEST_PROFILE_ID);
    void backend;
  });

  it("says so when the startup is gone", async () => {
    await expect(scoreStartupJob.run({ id: "gone" }, context())).rejects.toThrow("That startup is no longer in the list.");
  });
});
