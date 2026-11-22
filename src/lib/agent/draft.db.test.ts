import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { loadApplicationRows } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { loadDashboard } from "@/lib/dashboard-data";
import { postingStates } from "@/lib/postings";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { MockProvider } from "../ai/providers/mock";

import { candidateData } from "./candidates";
import { approveCandidate, dismissCandidate, draftCandidate, restoreCandidate } from "./draft";
import { resetInterruptedDrafts } from "./schedule";
import { attributeAgentCandidates } from "./attribution";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("@/lib/notifications/notify", () => ({ emit: vi.fn(async () => 0) }));
// The AI model scores, as Settings → Scoring has it by default (E25-7).
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
// The source gives the whole text unless a test says otherwise.
const source = vi.hoisted(() => ({ text: null as string | null, failWriting: 0, notPosting: false }));
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn(async (posting: { description: string; complete: boolean }) => (posting.complete ? posting.description : source.text)) }));
// A fake AI that answers each step of reading and writing.
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: async (call) => {
        switch (call.json?.name) {
          case "extracted_posting":
            return {
              title: "Senior Product Designer · Ledgerly",
              company: "Ledgerly",
              role: "Senior Product Designer",
              location: "Amsterdam",
              mode: "Hybrid",
              salary: "",
              deadline: null,
              requirements: [{ text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null }],
              asksForReferences: false,
              language: "English",
              isPosting: !source.notPosting,
            };
          case "posting_factors": {
            const { factorsAnswer } = await import("@/test/scoring");
            return factorsAnswer(call, "high");
          }
          case "tailored_resume":
            if (source.failWriting > 0) {
              source.failWriting -= 1;
              return "no json";
            }
            return { summary: "Product designer for payments.", roles: [], projects: [], skills: ["Figma"], education: [] };
          case "cover_letter":
            return { recipient: "Ledgerly · Hiring team", greeting: "Dear Ledgerly team,", paragraphs: [{ label: "Opening", text: "Payments need calm design." }], signOff: "Warm regards," };
          default:
            throw new Error(`No answer for ${call.json?.name}`);
        }
      },
    }),
}));

const prisma = () => db.client!;
const posting: FoundPosting = {
  source: "JSEARCH",
  externalId: "ledgerly-1",
  title: "Senior Product Designer, Payments",
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "",
  postedAt: "2026-10-19T00:00:00.000Z",
  url: "https://jobs.example/ledgerly-1",
  via: "LinkedIn",
  description: "Ledgerly is hiring a Senior Product Designer for Payments.",
  complete: true,
};
const context = (abort?: AbortController): JobContext => ({ id: "draft-job", step: async () => {}, signal: (abort ?? new AbortController()).signal });
const candidate = (found = posting) => prisma().agentCandidate.create({ data: candidateData(found, { score: 91, reasons: ["Figma"], redFlags: [] }) });

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  Object.assign(source, { text: null, failWriting: 0 });
  // Trimming renders PDFs: not what these tests are about.
});
afterAll(() => prisma().$disconnect());

describe("preparing a draft (E16-5)", () => {
  it("writes it like New application, as an agent draft waiting for review", async () => {
    const { id } = await candidate();
    await prisma().job.create({ data: { id: "draft-job", type: "agent-draft", key: `agent-candidate:${id}`, status: "RUNNING", input: { candidateId: id } } });
    const applicationId = await draftCandidate(id, context());
    const application = await prisma().application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: true, messages: true } });
    expect(application).toMatchObject({ origin: "AGENT", agentScore: 91, awaitingReview: true, status: "DRAFT", company: "Ledgerly", postingUrl: posting.url });
    expect(application.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "RESUME"]);
    expect(application.messages[0].text).toMatch(/^Here's what I tailored for Ledgerly:/);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFTED", applicationId, error: null });
    // The job that made it goes with it.
    expect(await prisma().job.findUniqueOrThrow({ where: { id: "draft-job" } })).toMatchObject({ applicationId });
    // Not linked to Find jobs, nor applied for there, until it's approved.
    expect(await prisma().posting.count()).toBe(0);
  });

  it("writes it from the profile of the search that first found it, else the first (E24-6)", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    const go = await prisma().agentSearch.create({ data: { name: "Go", query: { keywords: "Go", country: "nl" }, profileId: backend.id } });
    const design = await prisma().agentSearch.create({ data: { name: "Design", query: { keywords: "Designer", country: "nl" } } });
    const { id } = await candidate();
    await prisma().agentCandidateSearch.create({ data: { candidateId: id, searchId: go.id, searchName: go.name, createdAt: new Date("2026-10-19T08:00:00Z") } });
    await prisma().agentCandidateSearch.create({ data: { candidateId: id, searchId: design.id, searchName: design.name, createdAt: new Date("2026-10-19T09:00:00Z") } });
    const applicationId = await draftCandidate(id, context());
    expect(await prisma().application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ profileId: backend.id });

    const other = await candidate({ ...posting, externalId: "ledgerly-2", url: "https://jobs.example/ledgerly-2" });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: await draftCandidate(other.id, context()) } })).toMatchObject({ profileId: TEST_PROFILE_ID });
  });

  it("writes it from the profile that fits it best when its search scores against all of them (E25-5, E32-2)", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" } });
    const all = await prisma().agentSearch.create({ data: { name: "All", query: { keywords: "Designer", country: "nl" }, allProfiles: true } });
    const { id } = await candidate();
    await prisma().agentCandidateSearch.create({ data: { candidateId: id, searchId: all.id, searchName: all.name } });
    // Best by coverage (E32-2): Backend covers all three; the score out of 100 doesn't decide.
    const score = (profileId: string, value: number, hit: number) =>
      prisma().postingScore.create({
        data: {
          source: posting.source,
          externalId: posting.externalId,
          profileId,
          score: value,
          reasons: [],
          redFlags: [],
          scoredWith: "test",
          breakdown: { factors: [], cap: null, requirements: [0, 1, 2].map((index) => ({ text: `R${index}`, mustHave: true, covered: index < hit, evidence: null })) },
        },
      });
    await score(TEST_PROFILE_ID, 90, 1);
    await score(backend.id, 60, 3);
    const applicationId = await draftCandidate(id, context());
    expect(await prisma().application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ profileId: backend.id });
  });

  it("says a draft is ready only when the agent prepared it on its own (E26-6)", async () => {
    const { emit } = await import("@/lib/notifications/notify");
    const { agentDraftJob } = await import("./draft");
    vi.mocked(emit).mockClear();
    const own = await candidate();
    await agentDraftJob.run({ candidateId: own.id, auto: true }, context());
    // Kept with no requirements, so no coverage to tell (E32-2).
    expect(emit).toHaveBeenCalledWith("draft.ready", { applicationId: expect.any(String), title: posting.title, company: "Ledgerly", coverage: null });
    vi.mocked(emit).mockClear();
    const asked = await candidate({ ...posting, externalId: "ledgerly-3", url: "https://jobs.example/ledgerly-3" });
    await agentDraftJob.run({ candidateId: asked.id, auto: false }, context());
    expect(emit).not.toHaveBeenCalled();
  });

  it("makes one application, however often it's asked", async () => {
    const { id } = await candidate();
    const [first, second] = await Promise.allSettled([draftCandidate(id, context()), draftCandidate(id, context())]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const again = await draftCandidate(id, context());
    expect(await prisma().application.count()).toBe(1);
    expect(again).toBe((first.status === "fulfilled" ? first : (second as PromiseFulfilledResult<string>)).value);
  });

  it("goes back to the queue with the error when it fails, and works on a retry", async () => {
    const { id } = await candidate();
    source.failWriting = 2;
    await expect(draftCandidate(id, context())).rejects.toThrow();
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "SCORED",
      error: "The model's answer didn't come back in the expected shape. Try again.",
    });
    expect(await prisma().application.count()).toBe(0);
    await draftCandidate(id, context());
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DRAFTED", error: null });
  });

  it("writes no draft from a text that isn't a posting, and says why (#232)", async () => {
    const { id } = await candidate();
    source.notPosting = true;
    try {
      await expect(draftCandidate(id, context())).rejects.toMatchObject({ kind: "not-posting" });
    } finally {
      source.notPosting = false;
    }
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "SCORED",
      error: "That text doesn't look like a job posting: only a cookie notice, menus or a form came through. Paste the posting itself.",
    });
    expect(await prisma().application.count()).toBe(0);
  });

  it("fetches the whole posting for a snippet, and refuses one with no text", async () => {
    const { id } = await candidate({ ...posting, complete: false, description: "A snippet…" });
    source.text = "The whole posting, fetched.";
    await draftCandidate(id, context());
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ description: "The whole posting, fetched.", complete: true });

    const empty = await candidate({ ...posting, externalId: "empty", url: "https://jobs.example/empty", complete: false, description: " " });
    source.text = null;
    await expect(draftCandidate(empty.id, context())).rejects.toThrow("That posting has no text to write from. Open it and start an application by hand.");
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: empty.id } })).toMatchObject({ status: "SCORED" });
  });

  it("can be prepared again after a restart interrupted it", async () => {
    const { id } = await candidate();
    await prisma().agentCandidate.update({ where: { id }, data: { status: "DRAFTING" } });
    await expect(draftCandidate(id, context())).rejects.toThrow("That posting is no longer waiting for a draft.");
    await resetInterruptedDrafts();
    expect(await draftCandidate(id, context())).toBeTruthy();
  });
});

describe("drafts waiting for review (#195)", () => {
  it("stay out of Applications, the dashboard and Find jobs until they're approved", async () => {
    const { id } = await candidate();
    const applicationId = await draftCandidate(id, context());
    expect(await loadApplicationRows({ archived: true, sort: DEFAULT_SORT })).toEqual([]);
    expect((await loadDashboard()).total).toBe(0);
    expect((await postingStates([posting])).get("JSEARCH:ledgerly-1")).toMatchObject({ applicationId: null });

    expect(await approveCandidate(id)).toBe(applicationId);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "APPROVED" });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: applicationId } })).toMatchObject({ awaitingReview: false, status: "DRAFT" });
    expect((await loadApplicationRows({ archived: false, sort: DEFAULT_SORT })).map((row) => row.id)).toEqual([applicationId]);
    expect((await postingStates([posting])).get("JSEARCH:ledgerly-1")).toMatchObject({ applicationId });
    await expect(approveCandidate(id)).rejects.toThrow("That draft isn't ready to approve.");
  });
});

describe("dismissing (E16-5)", () => {
  it("does not leave attribution when dismissal races a scan", async () => {
    const { id } = await candidate();
    const search = await prisma().agentSearch.create({ data: { name: "Design", query: { keywords: "Designer", country: "nl" } } });
    await Promise.all([attributeAgentCandidates(search, [posting]), dismissCandidate(id)]);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DISMISSED" });
  });

  it("removes all search attribution, including deleted-search labels, and does not recreate it on rediscovery or Undo", async () => {
    const { id } = await candidate();
    const search = await prisma().agentSearch.create({ data: { name: "Design", query: { keywords: "Designer", country: "nl" } } });
    await attributeAgentCandidates(search, [posting]);
    await prisma().agentCandidateSearch.create({ data: { candidateId: id, searchName: "Deleted search" } });
    expect(await prisma().agentCandidateSearch.count()).toBe(2);

    const { undo } = await dismissCandidate(id);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    await attributeAgentCandidates(search, [posting]);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    await restoreCandidate(undo!);
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    expect(await prisma().agentSearch.count()).toBe(1);
  });

  it("deletes a draft with its documents and chat, marks the posting dismissed, and keeps only what dedupe needs", async () => {
    const { id, dedupeKey } = await candidate();
    const applicationId = await draftCandidate(id, context());
    await prisma().agentCandidateSearch.create({ data: { candidateId: id, searchName: "Design" } });
    expect(await dismissCandidate(id)).toEqual({ undo: null });
    expect(await prisma().agentCandidateSearch.count()).toBe(0);
    expect(await prisma().application.count()).toBe(0);
    expect(await prisma().document.count()).toBe(0);
    expect(await prisma().chatMessage.count()).toBe(0);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "DISMISSED",
      title: posting.title,
      company: "Ledgerly",
      dedupeKey,
      description: "",
      url: "",
      applicationId: null,
      reasons: [],
    });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ externalId: "ledgerly-1", dismissedAt: expect.any(Date) });
    expect(applicationId).toBeTruthy();
  });

  it("cancels a draft in progress, which then isn't made", async () => {
    const { id } = await candidate();
    const abort = new AbortController();
    await prisma().agentCandidate.update({ where: { id }, data: { status: "DRAFTING" } });
    await dismissCandidate(id);
    abort.abort();
    // The draft's job, finishing anyway, finds it dismissed.
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DISMISSED" });
    expect(await prisma().application.count()).toBe(0);
  });

  it("puts a posting dismissed before it had a draft back, as it was", async () => {
    const { id } = await candidate();
    const { undo } = await dismissCandidate(id);
    expect(undo).toMatchObject({ id, url: posting.url, description: posting.description, reasons: ["Figma"] });
    await restoreCandidate(undo!);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "SCORED", url: posting.url, reasons: ["Figma"] });
    // Out of Positions' Dismissed again (it stays in the library, E22-5).
    expect(await prisma().posting.count({ where: { dismissedAt: { not: null } } })).toBe(0);
  });

  it("leaves an approved draft alone", async () => {
    const { id } = await candidate();
    await draftCandidate(id, context());
    await approveCandidate(id);
    await expect(dismissCandidate(id)).rejects.toThrow("That draft was approved: it's in Applications now.");
    expect(await prisma().application.count()).toBe(1);
  });
});
