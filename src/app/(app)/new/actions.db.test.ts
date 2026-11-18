import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { startJob } from "@/lib/jobs/runner";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { addGapSkill, addSentApplication, savePostingForLater, startReadingPosting, startWritingApplication } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "write-job"),
}));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});

const prisma = () => db.client!;

const extracted = {
  title: "Senior Product Designer · Ledgerly",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  salary: null,
  deadline: "2026-10-15",
  requirements: [{ text: "Experience with payments", kind: "other" as const, skill: null, years: null, language: null }],
  asksForReferences: false,
  language: "English",
};
const match = { items: [{ requirement: "Experience with payments", result: "gap" as const, skill: null, experienceIds: [], note: "Nothing in your profile" }] };
const details = { title: "Designer at Ledgerly", company: "Ledgerly B.V.", role: "Senior Product Designer", location: "Amsterdam", mode: "Hybrid", salary: "", deadline: "2026-10-20" };

async function finishedJobs(profileId?: string) {
  await prisma().job.create({
    data: {
      id: "read-job",
      type: "read-posting",
      status: "DONE",
      input: { posting: "Ledgerly is hiring a Senior Product Designer.", ...(profileId ? { profileId } : {}) },
      result: { extracted, extractedWith: "extract-posting@1", match, matchedWith: "match-requirements@1" },
    },
  });
  await prisma().job.create({
    data: {
      id: "write-job",
      type: "write-documents",
      status: "DONE",
      input: { readJobId: "read-job", posting: "Ledgerly is hiring a Senior Product Designer.", extracted, match, tone: "FORMAL", note: "Relocating in January." },
      result: {
        resume: demoResumeUnits(),
        resumeWith: "tailor-resume@1",
        letter: [...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Kind regards," }],
        letterWith: "write-cover-letter@1",
      },
    },
  });
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  vi.mocked(startJob).mockClear();
});
afterAll(() => prisma().$disconnect());

describe("startWritingApplication (E31-4)", () => {
  const writing = { readJobId: "read-job", details, match, tone: "FORMAL" as const, note: "Relocating in January.", postingUrl: "jobs.ledgerly.example/42" };

  it("makes the Draft at once, from the reading and the details as edited, and writes its documents into it on the server", async () => {
    await finishedJobs();
    const result = await startWritingApplication({ ...writing, knownGaps: ["Experience with payments"] });
    if (!result.ok) throw new Error(result.error);
    const id = result.data;
    const application = await prisma().application.findUniqueOrThrow({ where: { id }, include: { documents: true, messages: true, knownGaps: true, facts: true } });
    expect(application).toMatchObject({
      status: "DRAFT",
      title: "Designer at Ledgerly",
      company: "Ledgerly B.V.",
      postingUrl: "https://jobs.ledgerly.example/42",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
      extracted: { company: "Ledgerly" },
      extractedWith: "extract-posting@1",
      match,
      matchedWith: "match-requirements@1",
      tone: "FORMAL",
      language: "English",
      profileId: TEST_PROFILE_ID,
    });
    expect(application.deadline?.toISOString().slice(0, 10)).toBe("2026-10-20");
    // Nothing written yet: that's the job's.
    expect(application.documents).toEqual([]);
    expect(application.messages).toEqual([]);
    // "Anything I should know?" is its first fact (APP-15); "I don't have this" is kept (E30-5).
    expect(application.facts.map((fact) => fact.text)).toEqual(["Relocating in January."]);
    expect(application.knownGaps.map((gap) => gap.requirement)).toEqual(["Experience with payments"]);
    expect(vi.mocked(startJob)).toHaveBeenCalledWith(expect.objectContaining({ type: "write-application" }), { applicationId: id, write: "both" }, { key: `writing:${id}`, applicationId: id });
    expect(await prisma().job.findUniqueOrThrow({ where: { id: "read-job" } })).toMatchObject({ key: `application:${id}`, applicationId: id });
  });

  it("returns the same application when asked twice, and writes once", async () => {
    await finishedJobs();
    const [first, second] = await Promise.all([startWritingApplication(writing), startWritingApplication(writing)]);
    const third = await startWritingApplication(writing);
    const ids = [first, second, third].filter((result) => result.ok).map((result) => (result.ok ? result.data : ""));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma().application.count()).toBe(1);
    expect(vi.mocked(startJob)).toHaveBeenCalledTimes(1);
  });

  it("needs a finished reading, and a link that's a web address", async () => {
    expect(await startWritingApplication({ ...writing, readJobId: "gone" })).toMatchObject({ ok: false, error: "That reading of the posting is no longer available. Read the posting again." });
    await finishedJobs();
    expect(await startWritingApplication({ ...writing, postingUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(await prisma().application.count()).toBe(0);
  });

  it("writes in the language chosen, else Settings', else the posting's (E31-3)", async () => {
    await finishedJobs();
    const dutch = await startWritingApplication({ ...writing, language: "Dutch" });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: dutch.ok ? dutch.data : "" } })).toMatchObject({ language: "Dutch" });
  });

  it("makes it from the profile the posting was read with (E24-6)", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    expect(await startReadingPosting({ posting: "Acme is hiring.", profileId: backend.id })).toEqual({ ok: true, data: "write-job" });
    expect(vi.mocked(startJob).mock.calls[0][1]).toEqual({ posting: "Acme is hiring.", profileId: backend.id });
    await startReadingPosting({ posting: "Acme is hiring.", profileId: "deleted" });
    expect(vi.mocked(startJob).mock.calls[1][1]).toEqual({ posting: "Acme is hiring.", profileId: TEST_PROFILE_ID });

    await finishedJobs(backend.id);
    const result = await startWritingApplication(writing);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: result.ok ? result.data : "" } })).toMatchObject({ profileId: backend.id });
  });

  it("links the Find jobs posting and the startup it was started from, leaving one already applied for alone (E14-8, #222)", async () => {
    await finishedJobs();
    const earlier = await prisma().application.create({ data: { title: "Applied before" } });
    const taken = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-0", applicationId: earlier.id } });
    expect(await startWritingApplication({ ...writing, postingId: taken.id })).toMatchObject({ ok: true });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: taken.id } })).toMatchObject({ applicationId: earlier.id });

    await prisma().job.delete({ where: { id: "read-job" } });
    await prisma().job.delete({ where: { id: "write-job" } });
    await finishedJobs();
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Senior Product Designer" } });
    const startup = await prisma().startup.create({ data: { source: "HN", externalId: "1", company: "Ledgerly", roles: [], emails: [], links: [], reasons: [] } });
    const result = await startWritingApplication({ ...writing, postingId: posting.id, startupId: startup.id });
    const id = result.ok ? result.data : "";
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: id });
    expect(await prisma().startup.findUniqueOrThrow({ where: { id: startup.id } })).toMatchObject({ applicationId: id });
  });
});

describe("savePostingForLater (E31-3)", () => {
  const later = { posting: "Ledgerly is hiring a Senior Product Designer.", postingUrl: "jobs.ledgerly.example/42", details: { title: "Designer at Ledgerly", company: "Ledgerly B.V.", role: "Senior Product Designer", location: "Amsterdam", mode: "Remote", salary: "€80k" } };

  it("saves a pasted posting under Saved in Positions, as Pasted, with the reading's score; the same text twice is one", async () => {
    await finishedJobs();
    await prisma().job.update({
      where: { id: "read-job" },
      data: { result: { extracted, extractedWith: "extract-posting@1", match, matchedWith: "score-posting@3", fit: { score: 72, reasons: ["Payments"], redFlags: [] } } },
    });
    const result = await savePostingForLater({ ...later, readJobId: "read-job" });
    if (!result.ok) throw new Error(result.error);
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: result.data } })).toMatchObject({
      source: "PASTED",
      title: "Senior Product Designer",
      company: "Ledgerly B.V.",
      place: "Amsterdam",
      remote: true,
      salary: "€80k",
      url: "https://jobs.ledgerly.example/42",
      description: "Ledgerly is hiring a Senior Product Designer.",
      complete: true,
      savedAt: expect.any(Date),
      applicationId: null,
    });
    expect(await prisma().postingScore.findMany({ select: { source: true, score: true, profileId: true, scoredWith: true } })).toEqual([
      { source: "PASTED", score: 72, profileId: TEST_PROFILE_ID, scoredWith: "score-posting@3" },
    ]);
    expect(await savePostingForLater(later)).toEqual({ ok: true, data: result.data });
    expect(await prisma().posting.count()).toBe(1);
  });

  it("saves the Positions posting it was started from", async () => {
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", dismissedAt: new Date() } });
    expect(await savePostingForLater({ ...later, postingId: posting.id })).toEqual({ ok: true, data: posting.id });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ savedAt: expect.any(Date), dismissedAt: null });
  });
});

describe("addGapSkill (E30-5 before writing)", () => {
  it("adds the skill to the profile, linked to the role it was used in, with what was done there", async () => {
    const role = await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, company: "Northwind", role: "Designer", bullets: "Ran research." } });
    const result = await addGapSkill({ profileId: TEST_PROFILE_ID, name: "Payments", experienceId: role.id, did: "Designed the payouts flow." });
    expect(result).toEqual({ ok: true, data: { name: "Payments", where: "Northwind", experienceId: role.id } });
    expect(await prisma().experience.findUniqueOrThrow({ where: { id: role.id }, include: { skills: { include: { skill: true } } } })).toMatchObject({
      bullets: "Ran research.\nDesigned the payouts flow.",
      skills: [{ skill: { name: "Payments" } }],
    });
  });
});

describe("addSentApplication (public #129)", () => {
  const sent = { posting: "Ledgerly is hiring a Senior Product Designer.", postingUrl: "jobs.example/ledgerly", company: "Ledgerly", role: "Senior Product Designer", sentOn: "2026-09-01", status: "SENT" as const };

  it("adds an application sent on that day, without documents or the AI", async () => {
    const result = await addSentApplication(sent);
    if (!result.ok) throw new Error(result.error);
    const application = await prisma().application.findUniqueOrThrow({ where: { id: result.data }, include: { documents: true, events: true, messages: true } });
    expect(application).toMatchObject({
      status: "SENT",
      title: "Senior Product Designer · Ledgerly",
      company: "Ledgerly",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
      postingUrl: "https://jobs.example/ledgerly",
      sentAt: new Date("2026-09-01T12:00:00Z"),
      furthestStage: "SENT",
      profileId: TEST_PROFILE_ID,
    });
    expect(application.documents).toEqual([]);
    expect(application.messages).toEqual([]);
    expect(application.events).toMatchObject([{ from: "DRAFT", to: "SENT", at: new Date("2026-09-01T12:00:00Z") }]);
    expect(startJob).not.toHaveBeenCalled();
  });

  it("records where it stands now, after the day it was sent", async () => {
    const result = await addSentApplication({ ...sent, status: "INTERVIEW" });
    if (!result.ok) throw new Error(result.error);
    const application = await prisma().application.findUniqueOrThrow({ where: { id: result.data }, include: { events: { orderBy: { at: "asc" } } } });
    expect(application).toMatchObject({ status: "INTERVIEW", furthestStage: "INTERVIEW", sentAt: new Date("2026-09-01T12:00:00Z") });
    expect(application.events.map((event) => event.to)).toEqual(["SENT", "INTERVIEW"]);
  });

  it("links the posting it was started from, and asks for a company or role and a day that has been", async () => {
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Senior Product Designer" } });
    const result = await addSentApplication({ ...sent, postingId: posting.id });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: result.ok ? result.data : "" });

    expect(await addSentApplication({ ...sent, company: " ", role: "" })).toMatchObject({ ok: false, error: "Give the company or the role." });
    expect(await addSentApplication({ ...sent, sentOn: "2999-01-01" })).toMatchObject({ ok: false, error: "The day you sent it can't be in the future." });
    expect(await addSentApplication({ ...sent, postingUrl: "not a link" })).toMatchObject({ ok: false });
  });
});
