import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { calendarDay } from "@/lib/application-documents";
import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { startJob } from "@/lib/jobs/runner";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { createApplication, startWritingDocuments } from "./actions";

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
// Trimming renders PDFs; here it says what it would cut.
const trim = vi.hoisted(() => ({ result: { trimmed: [] as unknown[], fits: true } }));
vi.mock("@/lib/page-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-limit")>()),
  fitResumeToPages: vi.fn(async () => trim.result),
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

async function finishedJobs() {
  await prisma().job.create({
    data: {
      id: "read-job",
      type: "read-posting",
      status: "DONE",
      input: { posting: "Ledgerly is hiring a Senior Product Designer." },
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

describe("startWritingDocuments", () => {
  it("writes from the posting as read, with the details as edited (E7-6)", async () => {
    await finishedJobs();
    expect(await startWritingDocuments({ readJobId: "read-job", details, match, tone: "WARM", note: "Hi" })).toEqual({ ok: true, data: "write-job" });
    expect(vi.mocked(startJob).mock.calls[0][1]).toMatchObject({
      readJobId: "read-job",
      posting: "Ledgerly is hiring a Senior Product Designer.",
      extracted: { company: "Ledgerly B.V.", title: "Designer at Ledgerly", salary: null, deadline: "2026-10-20", requirements: extracted.requirements },
      tone: "WARM",
      note: "Hi",
    });
  });

  it("needs a finished reading", async () => {
    expect(await startWritingDocuments({ readJobId: "gone", details, match, tone: "WARM", note: "" })).toMatchObject({
      ok: false,
      error: "That reading of the posting is no longer available. Read the posting again.",
    });
  });
});

describe("createApplication", () => {
  it("creates the draft, both documents in the base theme and the first message, in one go (E7-6)", async () => {
    await finishedJobs();
    const result = await createApplication({ writeJobId: "write-job", details, postingUrl: "jobs.ledgerly.example/42" });
    expect(result.ok).toBe(true);
    const id = result.ok ? result.data : "";
    const application = await prisma().application.findUniqueOrThrow({ where: { id }, include: { documents: { orderBy: { kind: "asc" } }, messages: true } });
    // Each document's history starts with the first draft (E8-10).
    expect(await prisma().documentVersion.findMany({ where: { document: { applicationId: id } }, select: { cause: true } })).toEqual([{ cause: "WRITTEN" }, { cause: "WRITTEN" }]);
    expect(application).toMatchObject({
      status: "DRAFT",
      title: "Designer at Ledgerly",
      company: "Ledgerly B.V.",
      salary: "",
      postingUrl: "https://jobs.ledgerly.example/42",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
      extracted: { company: "Ledgerly" },
      extractedWith: "extract-posting@1",
      matchedWith: "match-requirements@1",
      tone: "FORMAL",
      userNote: "Relocating in January.",
      language: "English",
    });
    expect(application.deadline?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(application.documents.map((document) => [document.kind, document.themeId, document.writtenWith])).toEqual([
      ["RESUME", "editorial", "tailor-resume@1"],
      ["COVER_LETTER", "editorial", "write-cover-letter@1"],
    ]);
    expect(application.messages).toHaveLength(1);
    expect(application.messages[0]).toMatchObject({ role: "AI", text: expect.stringMatching(/^Here's what I tailored for Ledgerly B\.V\.:\n\n- /) });
    expect(application.messages[0].text).toMatch(/Nothing invented: every line comes from your profile\.$/);
    expect(await prisma().job.count({ where: { key: `application:${id}`, applicationId: id } })).toBe(2);
  });

  it("links the Find jobs posting it was started from (E14-8)", async () => {
    await finishedJobs();
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Senior Product Designer" } });
    const result = await createApplication({ writeJobId: "write-job", details, postingUrl: "", postingId: posting.id });
    expect(result.ok).toBe(true);
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: result.ok ? result.data : "" });
  });

  it("leaves a posting that already has an application, and one that's gone, alone", async () => {
    await finishedJobs();
    const earlier = await prisma().application.create({ data: { title: "Applied before" } });
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", applicationId: earlier.id } });
    expect(await createApplication({ writeJobId: "write-job", details, postingUrl: "", postingId: posting.id })).toMatchObject({ ok: true });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: earlier.id });
  });

  it("creates the application when its posting was removed meanwhile", async () => {
    await finishedJobs();
    expect(await createApplication({ writeJobId: "write-job", details, postingUrl: "", postingId: "gone" })).toMatchObject({ ok: true });
  });

  it("stores every part of the letter: the sender and signature from the profile, the date written now, in its language (E8-11)", async () => {
    await finishedJobs();
    await prisma().setting.create({ data: { key: "docLanguage", value: "German" } });
    const result = await createApplication({ writeJobId: "write-job", details, postingUrl: "" });
    const letter = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: result.ok ? result.data : "", kind: "COVER_LETTER" } } });
    const units = letter.units as { id: string; text: string }[];
    expect(units.map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "paragraph:1", "paragraph:2", "paragraph:3", "paragraph:4", "sign-off", "signature"]);
    const text = (id: string) => units.find((unit) => unit.id === id)?.text;
    expect(text("sender")).toMatch(/^Jane Doe\n.*jane\.doe@example\.com/);
    expect(text("signature")).toBe("Jane Doe");
    expect(text("date")).toBe(new Intl.DateTimeFormat("de", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(calendarDay()));
    // This job's letter came without a recipient or greeting, so German ones stand in.
    expect(text("recipient")).toMatch(/^Ledgerly B\.V\. · Personalabteilung/);
    expect(text("greeting")).toBe("Sehr geehrte Damen und Herren,");
    expect(await prisma().documentVersion.findFirstOrThrow({ where: { documentId: letter.id } })).toMatchObject({ units });
  });

  it("returns the same application when asked twice", async () => {
    await finishedJobs();
    const [first, second] = await Promise.all([
      createApplication({ writeJobId: "write-job", details, postingUrl: "" }),
      createApplication({ writeJobId: "write-job", details, postingUrl: "" }),
    ]);
    const third = await createApplication({ writeJobId: "write-job", details, postingUrl: "" });
    const ids = [first, second, third].filter((result) => result.ok).map((result) => (result.ok ? result.data : ""));
    expect(new Set(ids).size).toBe(1);
    expect(await prisma().application.count()).toBe(1);
  });

  it("refuses a link that isn't a web address, and documents that aren't ready", async () => {
    await finishedJobs();
    expect(await createApplication({ writeJobId: "write-job", details, postingUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    await prisma().job.update({ where: { id: "write-job" }, data: { status: "RUNNING" } });
    expect(await createApplication({ writeJobId: "write-job", details, postingUrl: "" })).toMatchObject({
      ok: false,
      error: "Those documents aren't ready. Try creating the application again.",
    });
    expect(await prisma().application.count()).toBe(0);
  });

  it("trims the resume to its page limit and says what was cut (E10-10)", async () => {
    const { fitResumeToPages } = await import("@/lib/page-limit");
    await finishedJobs();
    trim.result = {
      trimmed: [{ kind: "unit", unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 }],
      fits: true,
    };
    const result = await createApplication({ writeJobId: "write-job", details, postingUrl: "" });
    const id = result.ok ? result.data : "";
    expect(fitResumeToPages).toHaveBeenCalledWith(id, expect.objectContaining({ experience: expect.any(Array) }), 1);
    const [message] = await prisma().chatMessage.findMany({ where: { applicationId: id } });
    expect(message.text).toMatch(/\n- Left out Studio Brik \(2015–2018\) to fit one page\n\nNothing invented/);
    trim.result = { trimmed: [], fits: true };
  });

  it("trims to two pages when that's the limit (SET-9)", async () => {
    const { fitResumeToPages } = await import("@/lib/page-limit");
    vi.mocked(fitResumeToPages).mockClear();
    await prisma().setting.create({ data: { key: "pageLimit", value: "2" } });
    await finishedJobs();
    trim.result = {
      trimmed: [{ kind: "unit", unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 }],
      fits: true,
    };
    const result = await createApplication({ writeJobId: "write-job", details, postingUrl: "" });
    const id = result.ok ? result.data : "";
    expect(fitResumeToPages).toHaveBeenCalledWith(id, expect.anything(), 2);
    const [message] = await prisma().chatMessage.findMany({ where: { applicationId: id } });
    expect(message.text).toMatch(/- Left out Studio Brik \(2015–2018\) to fit two pages/);
    trim.result = { trimmed: [], fits: true };
  });

  it("leaves the resume as written without a page limit (SET-9)", async () => {
    const { fitResumeToPages } = await import("@/lib/page-limit");
    vi.mocked(fitResumeToPages).mockClear();
    await prisma().setting.create({ data: { key: "pageLimit", value: "none" } });
    await finishedJobs();
    expect(await createApplication({ writeJobId: "write-job", details, postingUrl: "" })).toMatchObject({ ok: true });
    expect(fitResumeToPages).not.toHaveBeenCalled();
  });
});
