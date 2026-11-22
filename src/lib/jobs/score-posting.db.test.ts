import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";
import { postingStates } from "@/lib/postings";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { factorsAnswer } from "@/test/scoring";
import { MockProvider } from "../ai/providers/mock";

import { scoreJobKey, scorePastedPostingJob, scorePostingJob } from "./score-posting";

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
const fake = vi.hoisted(() => ({ fullText: null as string | null, sent: [] as string[] }));
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn(async () => fake.fullText) }));
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
const posting: FoundPosting = {
  source: "ADZUNA",
  externalId: "az-1",
  title: "Product Designer",
  company: "Harbour Freight",
  place: "Rotterdam",
  remote: false,
  salary: "",
  postedAt: null,
  url: "https://jobs.example/az-1",
  via: "",
  description: "The start…",
  complete: false,
};
const context = () => {
  const steps: string[] = [];
  return { id: "score-job", steps, step: async (name: string) => void steps.push(name), signal: new AbortController().signal };
};

beforeEach(async () => {
  await resetDatabase(prisma());
  Object.assign(fake, { fullText: null, sent: [] });
});
afterAll(() => prisma().$disconnect());

describe("Score in Positions (#208)", () => {
  it("gets the whole posting for a snippet, scores it and keeps the score with it", async () => {
    fake.fullText = "The whole posting: design our freight tools.";
    const run = context();
    const { score: fit, scores } = await scorePostingJob.run({ posting }, run);
    // The engine's answer, added up (E25), with how it adds up, as the first profile's.
    expect(fit).toMatchObject({ profileId: TEST_PROFILE_ID, profileName: "", score: 71, redFlags: [], breakdown: { cap: null, requirements: [] } });
    expect(scores).toEqual([fit]);
    expect(fit!.reasons[1]).toBe("Work experience 17/25: Work: mid.");
    expect(run.steps).toEqual(["Getting the whole posting", "Scoring it against your profile"]);
    expect(fake.sent[0]).toContain("The whole posting: design our freight tools.");

    expect(
      await prisma().postingScore.findUniqueOrThrow({ where: { source_externalId_profileId: { source: "ADZUNA", externalId: "az-1", profileId: TEST_PROFILE_ID } } }),
    ).toMatchObject({ score: 71, scoredWith: "score-posting@3", breakdown: fit!.breakdown });
    expect((await postingStates([posting])).get("ADZUNA:az-1")?.score).toEqual(fit);
  });

  it("scores against one profile or all of them, keeping a score for each, the best first on the card (E25-5)", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    await prisma().profile.create({ data: { name: "Research", sort: 2 } });
    const one = await scorePostingJob.run({ posting: { ...posting, complete: true }, profiles: backend.id }, context());
    expect(one.scores.map((fit) => [fit.profileName, fit.score])).toEqual([["Backend", 71]]);

    // All of them, but Research, whose levels aren't chosen yet.
    const run = context();
    const all = await scorePostingJob.run({ posting: { ...posting, complete: true }, profiles: "all" }, run);
    expect(run.steps).toEqual(["Scoring it against “My profile”", "Scoring it against “Backend”"]);
    expect(all.scores.map((fit) => fit.profileName)).toEqual(["My profile", "Backend"]);
    expect(all.score).toMatchObject({ profileName: "My profile", score: 71 });
    expect(await prisma().postingScore.count()).toBe(2);
  });

  it("scores the start when the rest can't be had, and replaces an older score", async () => {
    await prisma().postingScore.create({ data: { source: "ADZUNA", externalId: "az-1", profileId: TEST_PROFILE_ID, score: 20, reasons: [], redFlags: [], scoredWith: "score-posting@1" } });
    // From before the engine (E25): no breakdown, and said so.
    expect((await postingStates([posting])).get("ADZUNA:az-1")?.score).toEqual({ profileId: TEST_PROFILE_ID, profileName: "", score: 20, reasons: [], redFlags: [], breakdown: null, older: true });
    const run = context();
    await scorePostingJob.run({ posting }, run);
    expect(fake.sent[0]).toContain("The start…");
    expect(await prisma().postingScore.count()).toBe(1);
    expect((await prisma().postingScore.findFirstOrThrow()).score).toBe(71);
    // A whole posting goes straight to scoring.
    const whole = context();
    await scorePostingJob.run({ posting: { ...posting, complete: true } }, whole);
    expect(whole.steps).toEqual(["Scoring it against your profile"]);
  });

  it("keys a posting's scoring, so a second click follows the first", () => {
    expect(scoreJobKey(posting)).toBe("posting-score:ADZUNA:az-1");
  });
});

describe("scorePastedPostingJob (public issue 66)", () => {
  it("scores a pasted posting with the details as read, and keeps nothing", async () => {
    fake.sent = [];
    const run = context();
    const result = await scorePastedPostingJob.run(
      { posting: "Harbour Freight is hiring a Product Designer in Rotterdam. Dutch required.", title: "Product Designer", company: "Harbour Freight", location: "Rotterdam", mode: "Hybrid, 2 days remote", salary: "" },
      run,
    );
    expect(result).toMatchObject({ score: 71, breakdown: { cap: null } });
    expect(fake.sent[0]).toContain("Harbour Freight is hiring a Product Designer");
    expect(run.steps).toEqual(["Scoring it against your profile"]);
    expect(await prisma().postingScore.count()).toBe(0);
  });
});
