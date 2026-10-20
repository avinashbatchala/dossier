import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";
import type { JobContext } from "@/lib/jobs/runner";
import { loadApplicationRows } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { loadDashboard } from "@/lib/dashboard-data";
import { postingStates } from "@/lib/postings";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { MockProvider } from "../ai/providers/mock";

import { candidateData } from "./candidates";
import { approveCandidate, dismissCandidate, draftCandidate, restoreCandidate } from "./draft";
import { resetInterruptedDrafts } from "./schedule";

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
// The source gives the whole text unless a test says otherwise.
const source = vi.hoisted(() => ({ text: null as string | null, failWriting: 0 }));
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn(async (posting: { description: string; complete: boolean }) => (posting.complete ? posting.description : source.text)) }));
// A fake AI that answers each step of reading and writing.
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  getAiProvider: async () =>
    new MockProvider({
      reply: (call) => {
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
            };
          case "requirement_matches":
            return { matches: [{ requirement: 1, skill: "Figma", language: null }] };
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
  await saveSettings({ pageLimit: "none" });
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
  it("deletes a draft with its documents and chat, marks the posting dismissed, and keeps only what dedupe needs", async () => {
    const { id, dedupeKey } = await candidate();
    const applicationId = await draftCandidate(id, context());
    expect(await dismissCandidate(id)).toEqual({ undo: null });
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
    // Out of Find jobs' Dismissed again, and not kept there for nothing.
    expect(await prisma().posting.count()).toBe(0);
  });

  it("leaves an approved draft alone", async () => {
    const { id } = await candidate();
    await draftCandidate(id, context());
    await approveCandidate(id);
    await expect(dismissCandidate(id)).rejects.toThrow("That draft was approved: it's in Applications now.");
    expect(await prisma().application.count()).toBe(1);
  });
});
