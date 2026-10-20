import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import {
  addMatchSkill,
  addNote,
  deleteNote,
  listVersions,
  loadVersion,
  putBackTrimmed,
  restoreNote,
  restoreUnit,
  restoreVersion,
  saveUnit,
  sendMessage,
  setFollowThemeLayout,
  setInterviewDate,
  startRegenerating,
  startWritingEmail,
  undoEmailRewrite,
  undoMessage,
  updateNote,
} from "./actions";

// The actions run against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The calendar's side is tested in src/lib/google; here it's off unless a test says otherwise.
const calendar = vi.hoisted(() => ({
  sync: vi.fn<(id: string) => Promise<{ inCalendar: boolean; eventLink: string | null }>>(async () => ({ inCalendar: false, eventLink: null })),
}));
vi.mock("@/lib/google/availability", () => ({ syncInterviewToCalendar: calendar.sync }));
const ai = vi.hoisted(() => ({ ready: true }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => ai.ready }));
// Jobs are queued for real, but don't run.
vi.mock("@/lib/jobs/runner", async (importOriginal) => {
  const runner = await importOriginal<typeof import("@/lib/jobs/runner")>();
  return {
    ...runner,
    startJob: vi.fn(async (definition: { type: string }, input: object, options: { key?: string; applicationId?: string }) => {
      const { prisma } = await import("@/lib/prisma");
      return (await prisma.job.create({ data: { type: definition.type, input, key: options.key, applicationId: options.applicationId } })).id;
    }),
  };
});

const prisma = () => db.client!;

const resume = [
  { id: "summary", label: "Summary", text: "Calm tools for complex work.", unverified: ["40%"] },
  { id: "experience:e1", label: "Northwind role", text: "Led the portal\nBuilt the design system" },
];

beforeEach(async () => {
  ai.ready = true;
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      title: "Designer at Ledgerly",
      company: "Ledgerly",
      documents: { create: [{ kind: "RESUME", units: resume }] },
    },
  });
});

const units = async () =>
  (await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } } }))
    .units as typeof resume;
afterAll(() => prisma().$disconnect());

describe("setFollowThemeLayout (E8-2)", () => {
  it("saves the layout switch on the application", async () => {
    expect(await setFollowThemeLayout({ id: "app-1", follow: true })).toEqual({ ok: true, data: null });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).toMatchObject({ followThemeLayout: true });
  });

  it("says so when the application is gone", async () => {
    expect(await setFollowThemeLayout({ id: "gone", follow: true })).toEqual({ ok: false, error: "That application no longer exists." });
  });
});

describe("setInterviewDate (E9-9)", () => {
  const saved = async () => (await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).nextInterviewAt;

  it("saves the next interview, and removes it", async () => {
    expect(await setInterviewDate({ id: "app-1", at: "2026-10-01T12:00:00.000Z" })).toEqual({
      ok: true,
      data: null,
      toast: "Interview date saved. It'll show on your dashboard.",
    });
    expect(await saved()).toEqual(new Date("2026-10-01T12:00:00Z"));
    expect(await setInterviewDate({ id: "app-1", at: null })).toMatchObject({ ok: true, toast: "Interview date removed." });
    expect(await saved()).toBeNull();
  });

  it("says when the calendar followed, and when it couldn't", async () => {
    const { GoogleError } = await import("@/lib/google/errors");
    calendar.sync.mockResolvedValueOnce({ inCalendar: true, eventLink: "https://calendar.google.com/event?eid=1" });
    expect(await setInterviewDate({ id: "app-1", at: "2026-10-01T12:00:00.000Z" })).toMatchObject({ ok: true, toast: "Interview date saved, in your calendar too." });
    expect(calendar.sync).toHaveBeenLastCalledWith("app-1");
    calendar.sync.mockResolvedValueOnce({ inCalendar: true, eventLink: null });
    expect(await setInterviewDate({ id: "app-1", at: null })).toMatchObject({ ok: true, toast: "Interview date removed, from your calendar too." });
    calendar.sync.mockRejectedValueOnce(new GoogleError("unavailable", "Couldn't reach Google. Try again in a moment."));
    expect(await setInterviewDate({ id: "app-1", at: "2026-10-02T12:00:00.000Z" })).toMatchObject({
      ok: true,
      toast: "Interview date saved, but your calendar wasn't changed: Couldn't reach Google. Try again in a moment.",
    });
    expect(await saved()).toEqual(new Date("2026-10-02T12:00:00Z"));
  });

  it("refuses what isn't a moment, and says so when the application is gone", async () => {
    expect(await setInterviewDate({ id: "app-1", at: "next Tuesday" })).toMatchObject({ ok: false });
    expect(await saved()).toBeNull();
    expect(await setInterviewDate({ id: "gone", at: null })).toEqual({ ok: false, error: "That application no longer exists." });
  });
});

describe("saveUnit (E8-3)", () => {
  const edit = { id: "app-1", document: "RESUME" as const, unitId: "summary", expected: "Calm tools for complex work." };

  it("saves the text and drops the fact guard's hints", async () => {
    expect(await saveUnit({ ...edit, text: "  Calm, clear tools.  " })).toEqual({ ok: true, data: { text: "Calm, clear tools." } });
    expect(await units()).toEqual([{ id: "summary", label: "Summary", text: "Calm, clear tools." }, resume[1]]);
  });

  it("keeps a role's bullets one per line, without bullet characters", async () => {
    const result = await saveUnit({ ...edit, unitId: "experience:e1", expected: resume[1].text, text: "- Led the portal\n\n• Built the design system\n" });
    expect(result).toEqual({ ok: true, data: { text: "Led the portal\nBuilt the design system" } });
  });

  it("refuses to overwrite a change made while editing", async () => {
    const result = await saveUnit({ ...edit, expected: "What the editor started from", text: "Mine" });
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/^This part changed while you were editing it/) });
    expect(await units()).toEqual(resume);
  });

  it("refuses an empty text", async () => {
    expect(await saveUnit({ ...edit, text: "  " })).toEqual({ ok: false, error: "Write something first, or cancel to keep it as it was." });
  });

  it("says so when the part is gone", async () => {
    expect(await saveUnit({ ...edit, unitId: "education:x", text: "Hi" })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });

  it("stores a frame part an older letter only showed, in reading order (E8-11)", async () => {
    const letter = [
      { id: "paragraph:1", label: "Opening", text: "Ich bewerbe mich." },
      { id: "sign-off", label: "Sign-off", text: "Mit freundlichen Grüßen" },
    ];
    await prisma().document.create({ data: { applicationId: "app-1", kind: "COVER_LETTER", units: letter } });
    const greeting = { id: "app-1", document: "COVER_LETTER" as const, unitId: "greeting", expected: "Dear Ledgerly team,", text: " Sehr geehrtes Ledgerly-Team, " };
    expect(await saveUnit(greeting)).toEqual({ ok: true, data: { text: "Sehr geehrtes Ledgerly-Team," } });
    expect(await saveUnit({ ...greeting, unitId: "signature", expected: "Your name", text: "Jane Doe" })).toMatchObject({ ok: true });
    const stored = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } } });
    expect(stored.units).toEqual([
      { id: "greeting", label: "Greeting", text: "Sehr geehrtes Ledgerly-Team," },
      ...letter,
      { id: "signature", label: "Signature", text: "Jane Doe" },
    ]);
    // Only the letter's frame: anything else that's missing is gone.
    expect(await saveUnit({ ...greeting, unitId: "paragraph:9" })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
  });
});

describe("startRegenerating (E8-4)", () => {
  it("rewrites the unit in the background, from its current text", async () => {
    const result = await startRegenerating({ id: "app-1", document: "RESUME", unitId: "summary" });
    expect(result.ok).toBe(true);
    const job = await prisma().job.findUniqueOrThrow({ where: { id: result.ok ? result.data : "" } });
    expect(job).toMatchObject({
      type: "regenerate-unit",
      key: "units:app-1",
      applicationId: "app-1",
      input: { applicationId: "app-1", document: "RESUME", unitId: "summary", from: resume[0].text },
    });
  });

  it("follows the rewrite already under way", async () => {
    const first = await startRegenerating({ id: "app-1", document: "RESUME", unitId: "summary" });
    const again = await startRegenerating({ id: "app-1", document: "RESUME", unitId: "summary" });
    const other = await startRegenerating({ id: "app-1", document: "RESUME", unitId: "experience:e1" });
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("says so when the part is gone", async () => {
    expect(await startRegenerating({ id: "app-1", document: "COVER_LETTER", unitId: "paragraph:1" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no longer exists/),
    });
  });

  it("stores the greeting an older letter only showed, then rewrites it (E8-11)", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "COVER_LETTER", units: [{ id: "paragraph:1", label: "Opening", text: "Ich bewerbe mich." }] } });
    const result = await startRegenerating({ id: "app-1", document: "COVER_LETTER", unitId: "greeting", shown: "Dear Ledgerly team," });
    expect(result.ok).toBe(true);
    const letter = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } } });
    expect(letter.units).toEqual([{ id: "greeting", label: "Greeting", text: "Dear Ledgerly team," }, { id: "paragraph:1", label: "Opening", text: "Ich bewerbe mich." }]);
    expect(await prisma().job.findUniqueOrThrow({ where: { id: result.ok ? result.data : "" } })).toMatchObject({ input: { unitId: "greeting", from: "Dear Ledgerly team," } });
  });

  it("leaves the letter's sender, date and signature to editing (E8-11)", async () => {
    for (const unitId of ["sender", "date", "signature"]) {
      expect(await startRegenerating({ id: "app-1", document: "COVER_LETTER", unitId })).toEqual({ ok: false, error: "This part isn't written by the AI. Edit it instead." });
    }
  });

  it("leaves the email's recipient to editing", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "john@example.com" }] } });
    expect(await startRegenerating({ id: "app-1", document: "EMAIL", unitId: "to" })).toEqual({ ok: false, error: "This part isn't written by the AI. Edit it instead." });
  });
});

describe("restoreUnit (E8-4)", () => {
  const undo = { id: "app-1", document: "RESUME" as const, unitId: "summary", text: "The old one.", unverified: ["2019"] };

  it("puts the previous version back", async () => {
    expect(await restoreUnit({ ...undo, expected: resume[0].text })).toEqual({ ok: true, data: null });
    expect((await units())[0]).toEqual({ id: "summary", label: "Summary", text: "The old one.", unverified: ["2019"] });
  });

  it("refuses when it changed again since", async () => {
    expect(await restoreUnit({ ...undo, expected: "The rewrite" })).toEqual({
      ok: false,
      error: "It's been changed again since, so this can't be undone.",
    });
    expect(await units()).toEqual(resume);
  });
});

describe("sendMessage (E8-5)", () => {
  const messages = () => prisma().chatMessage.findMany({ where: { applicationId: "app-1" }, orderBy: { createdAt: "asc" } });

  it("saves the message and starts the reply", async () => {
    const result = await sendMessage({ id: "app-1", text: " Shorter, please ", viewing: "RESUME", target: { document: "RESUME", unitId: "summary" } });
    expect(result.ok).toBe(true);
    const [message] = await messages();
    expect(message).toMatchObject({ role: "USER", text: "Shorter, please", targetUnit: "Summary" });
    const job = await prisma().job.findUniqueOrThrow({ where: { id: result.ok && result.data.jobId ? result.data.jobId : "" } });
    expect(job).toMatchObject({
      type: "refine",
      key: "refine:app-1",
      applicationId: "app-1",
      input: { applicationId: "app-1", messageId: message.id, request: "Shorter, please", viewing: "RESUME", target: { document: "RESUME", unitId: "summary" } },
    });
  });

  it("answers on the Job posting tab at once, in order", async () => {
    ai.ready = false;
    expect(await sendMessage({ id: "app-1", text: "Change the salary", viewing: null, target: null })).toEqual({ ok: true, data: { jobId: null } });
    expect((await messages()).map(({ role, text }) => [role, text])).toEqual([
      ["USER", "Change the salary"],
      ["AI", "I can change the resume, the cover letter or the email. Switch to one of them, or hover a section and pick “Ask AI”."],
    ]);
  });

  it("waits for the reply that's on its way", async () => {
    await sendMessage({ id: "app-1", text: "Shorter", viewing: "RESUME", target: null });
    expect(await sendMessage({ id: "app-1", text: "Longer", viewing: "RESUME", target: null })).toEqual({
      ok: false,
      error: "I'm still working on your last message. Send this one when I'm done.",
    });
    expect(await messages()).toHaveLength(1);
  });

  it("needs an AI provider for a change", async () => {
    ai.ready = false;
    expect(await sendMessage({ id: "app-1", text: "Shorter", viewing: "RESUME", target: null })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/needs an AI provider/),
    });
  });

  it("refuses an empty message", async () => {
    expect(await sendMessage({ id: "app-1", text: "  ", viewing: "RESUME", target: null })).toMatchObject({ ok: false });
  });
});

describe("undoMessage (E8-6)", () => {
  const edits = [
    { document: "RESUME", unitId: "summary", text: "Short.", previousText: resume[0].text, previousUnverified: ["40%"] },
    { document: "RESUME", unitId: "experience:e1", text: "Led it", previousText: resume[1].text },
  ];

  beforeEach(async () => {
    // The state after the reply: its edits applied, and the tone it set.
    const after = [{ id: "summary", label: "Summary", text: "Short." }, { ...resume[1], text: "Led it" }];
    await prisma().document.update({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } }, data: { units: after } });
    await prisma().application.update({ where: { id: "app-1" }, data: { tone: "FORMAL" } });
    await prisma().chatMessage.create({ data: { id: "m1", applicationId: "app-1", role: "AI", text: "Done.", edits, previousTone: "WARM" } });
  });

  it("puts the units and the tone back, and remembers it's undone", async () => {
    expect(await undoMessage({ id: "app-1", messageId: "m1" })).toEqual({
      ok: true,
      data: { edited: [{ document: "RESUME", unitId: "summary" }, { document: "RESUME", unitId: "experience:e1" }] },
    });
    expect(await units()).toEqual(resume);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).toMatchObject({ tone: "WARM" });
    expect(await prisma().chatMessage.findUniqueOrThrow({ where: { id: "m1" } })).toMatchObject({ undone: true });
    expect(await undoMessage({ id: "app-1", messageId: "m1" })).toEqual({ ok: false, error: "That's already undone." });
  });

  it("never overwrites a unit edited since", async () => {
    await saveUnit({ id: "app-1", document: "RESUME", unitId: "experience:e1", text: "My own bullets", expected: "Led it" });
    expect(await undoMessage({ id: "app-1", messageId: "m1" })).toEqual({
      ok: false,
      error: "You've changed the Northwind role since, so undoing this would overwrite that. Edit it by hand instead.",
    });
    // Nothing was put back, not even the summary.
    expect((await units())[0].text).toBe("Short.");
    expect(await prisma().chatMessage.findUniqueOrThrow({ where: { id: "m1" } })).toMatchObject({ undone: false });
  });

  it("has nothing to undo in a reply without edits", async () => {
    await prisma().chatMessage.create({ data: { id: "m2", applicationId: "app-1", role: "AI", text: "I left it out." } });
    expect(await undoMessage({ id: "app-1", messageId: "m2" })).toEqual({ ok: false, error: "There's nothing to undo in that message." });
  });
});

describe("addMatchSkill (E8-7)", () => {
  const requirement = (text: string, skill: string | null) => ({ text, kind: skill ? "skill" : "other", skill, years: null, language: null });
  const item = (text: string, result: string) => ({ requirement: text, result, skill: null, experienceIds: [], note: "Not in your profile" });

  beforeEach(async () => {
    await prisma().application.update({
      where: { id: "app-1" },
      data: {
        extracted: {
          title: null, company: "Ledgerly", role: null, location: null, mode: null, salary: null, deadline: null,
          requirements: [requirement("Experience with Kubernetes", "Kubernetes"), requirement("Fintech experience", null)],
          asksForReferences: false, language: "English",
        },
        match: { items: [item("Experience with Kubernetes", "gap"), item("Fintech experience", "gap")] },
      },
    });
  });

  it("adds the skill to the profile and marks the requirement partly covered", async () => {
    expect(await addMatchSkill({ id: "app-1", index: 0 })).toEqual({ ok: true, data: { name: "Kubernetes" } });
    expect(await prisma().skill.findMany({ select: { name: true } })).toEqual([{ name: "Kubernetes" }]);
    const { match } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(match).toMatchObject({ items: [{ result: "partial", skill: "Kubernetes", note: "In your skills, but not linked to a role yet" }, { result: "gap" }] });
  });

  it("refuses a requirement that isn't a skill", async () => {
    expect(await addMatchSkill({ id: "app-1", index: 1 })).toMatchObject({ ok: false });
    expect(await prisma().skill.count()).toBe(0);
  });
});

describe("notes (E8-9)", () => {
  const notes = () => prisma().note.findMany({ where: { applicationId: "app-1" } });

  it("adds, edits and deletes a note, and Undo brings it back with its dates", async () => {
    expect(await addNote({ id: "app-1", body: "  Called John.  " })).toEqual({ ok: true, data: null });
    const [note] = await notes();
    expect(note.body).toBe("Called John.");

    expect(await updateNote({ id: "app-1", noteId: note.id, body: "Called John; second round next week." })).toEqual({ ok: true, data: null });
    const [edited] = await notes();
    expect(edited.body).toBe("Called John; second round next week.");
    expect(edited.updatedAt.getTime()).toBeGreaterThan(note.updatedAt.getTime());

    const deleted = await deleteNote({ id: "app-1", noteId: note.id });
    expect(deleted).toEqual({
      ok: true,
      data: { body: edited.body, createdAt: edited.createdAt.toISOString(), updatedAt: edited.updatedAt.toISOString() },
    });
    expect(await notes()).toEqual([]);

    expect(await restoreNote({ id: "app-1", ...(deleted.ok ? deleted.data : ({} as never)) })).toEqual({ ok: true, data: null });
    expect(await notes()).toEqual([expect.objectContaining({ body: edited.body, createdAt: edited.createdAt, updatedAt: edited.updatedAt })]);
  });

  it("refuses an empty note", async () => {
    expect(await addNote({ id: "app-1", body: " " })).toMatchObject({ ok: false });
  });

  it("only touches this application's notes", async () => {
    await prisma().application.create({ data: { id: "app-2", notes: { create: { id: "other", body: "Theirs" } } } });
    expect(await updateNote({ id: "app-1", noteId: "other", body: "Mine" })).toEqual({ ok: false, error: "That note no longer exists." });
    expect(await deleteNote({ id: "app-1", noteId: "other" })).toEqual({ ok: false, error: "That note no longer exists." });
  });
});

describe("putBackTrimmed (E10-10)", () => {
  const role = { id: "experience:e3", label: "Studio Brik role", text: "Built things" };
  const trimmed = [
    { kind: "unit", unit: role, index: 1 },
    { kind: "bullets", unitId: "experience:e1", label: "Northwind role", lines: ["Mentored designers"] },
  ];
  const document = () => prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } } });

  beforeEach(async () => {
    await prisma().document.updateMany({ where: { applicationId: "app-1" }, data: { trimmed } });
  });

  it("puts a role back where it was", async () => {
    expect(await putBackTrimmed({ id: "app-1", index: 0 })).toEqual({ ok: true, data: null });
    const saved = await document();
    expect((saved.units as typeof resume).map((unit) => unit.id)).toEqual(["summary", "experience:e3", "experience:e1"]);
    expect(saved.trimmed).toEqual([trimmed[1]]);
  });

  it("puts bullets back at the end of their role, and forgets the list once it's empty", async () => {
    await putBackTrimmed({ id: "app-1", index: 1 });
    await putBackTrimmed({ id: "app-1", index: 0 });
    const saved = await document();
    expect((saved.units as typeof resume).find((unit) => unit.id === "experience:e1")!.text).toBe("Led the portal\nBuilt the design system\nMentored designers");
    expect(saved.trimmed).toBeNull();
  });

  it("says so when it's already back", async () => {
    expect(await putBackTrimmed({ id: "app-1", index: 5 })).toMatchObject({ ok: false, error: expect.stringMatching(/^That's already back/) });
  });
});

describe("versions (E8-10)", () => {
  const document = async () => prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } } });
  const versions = async () => {
    const result = await listVersions({ id: "app-1", document: "RESUME" });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };

  it("makes a version for an AI change, but not for an edit by hand", async () => {
    await saveUnit({ id: "app-1", document: "RESUME", unitId: "summary", text: "By hand.", expected: resume[0].text });
    expect(await versions()).toEqual([]);
    await restoreUnit({ id: "app-1", document: "RESUME", unitId: "summary", text: "The AI's text.", expected: "By hand." });
    expect(await versions()).toEqual([{ id: expect.any(String), cause: "UNDONE", detail: "", createdAt: expect.any(String) }]);
  });

  it("restores a version, saving what was there first, and marks the restored one", async () => {
    const { id: documentId } = await document();
    const written = await prisma().documentVersion.create({ data: { documentId, units: resume, cause: "WRITTEN", createdAt: new Date("2026-09-29T08:00:00Z") } });
    await saveUnit({ id: "app-1", document: "RESUME", unitId: "summary", text: "Rewritten by hand.", expected: resume[0].text });

    const loaded = await loadVersion({ id: "app-1", versionId: written.id });
    expect(loaded).toEqual({ ok: true, data: { document: "RESUME", units: resume } });

    const restored = await restoreVersion({ id: "app-1", versionId: written.id });
    expect(restored).toMatchObject({ ok: true, toast: "Restored the resume as it was then. The version you had is in the history too." });
    expect((await units())[0].text).toBe(resume[0].text);
    const list = await versions();
    expect(list.map((version) => version.cause)).toEqual(["RESTORED", "BEFORE_RESTORE", "WRITTEN"]);
    expect(list[0].detail).toBe("2026-09-29T08:00:00.000Z");
    const before = await loadVersion({ id: "app-1", versionId: list[1].id });
    expect(before.ok && before.data.units[0].text).toBe("Rewritten by hand.");

    // Restoring what's already there changes nothing.
    expect(await restoreVersion({ id: "app-1", versionId: written.id })).toEqual({ ok: false, error: "That's the version you have now." });
  });

  it("doesn't save the current state twice when it's already the newest version", async () => {
    const { id: documentId } = await document();
    const old = await prisma().documentVersion.create({ data: { documentId, units: [{ ...resume[0], text: "Old" }, resume[1]], cause: "WRITTEN", createdAt: new Date("2026-09-29T08:00:00Z") } });
    await prisma().documentVersion.create({ data: { documentId, units: resume, cause: "REGENERATED", detail: "Summary", createdAt: new Date("2026-09-29T09:00:00Z") } });
    await restoreVersion({ id: "app-1", versionId: old.id });
    expect((await versions()).map((version) => version.cause)).toEqual(["RESTORED", "REGENERATED", "WRITTEN"]);
  });

  it("puts parts left out to fit the page limit back in the restored version's list", async () => {
    const { id: documentId } = await document();
    const full = [...resume, { id: "experience:e2", label: "Studio role", text: "Did things" }];
    const written = await prisma().documentVersion.create({ data: { documentId, units: full, cause: "WRITTEN", createdAt: new Date("2026-09-29T08:00:00Z") } });
    await prisma().document.update({ where: { id: documentId }, data: { trimmed: [{ kind: "unit", unit: full[2], index: 2 }] } });
    await restoreVersion({ id: "app-1", versionId: written.id });
    expect((await document()).trimmed).toBeNull();
  });

  it("only shows an application's own versions", async () => {
    const other = await prisma().application.create({ data: { title: "Other", company: "Other", documents: { create: [{ kind: "RESUME", units: resume }] } }, include: { documents: true } });
    const version = await prisma().documentVersion.create({ data: { documentId: other.documents[0].id, units: resume, cause: "WRITTEN" } });
    expect(await loadVersion({ id: "app-1", versionId: version.id })).toMatchObject({ ok: false });
    expect(await restoreVersion({ id: "app-1", versionId: version.id })).toMatchObject({ ok: false });
  });
});

describe("the email", () => {
  const email = [
    { id: "to", label: "Recipient", text: "john@example.com" },
    { id: "subject", label: "Subject", text: "Application" },
    { id: "body", label: "Message", text: "Dear John,\n\nHello." },
  ];
  const rewritten = email.map((unit) => (unit.id === "body" ? { ...unit, text: "Dear John,\n\nHi again." } : unit));
  const saved = async () => (await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "EMAIL" } } })).units;
  const finishedRewrite = (result: object) =>
    prisma().job.create({ data: { type: "write-email", key: "email:app-1", status: "DONE", input: { applicationId: "app-1" }, result } });

  it("is written in the background, following a job already under way", async () => {
    const first = await startWritingEmail({ id: "app-1" });
    expect(first.ok).toBe(true);
    expect(await prisma().job.findUniqueOrThrow({ where: { id: first.ok ? first.data : "" } })).toMatchObject({
      type: "write-email",
      key: "email:app-1",
      applicationId: "app-1",
      input: { applicationId: "app-1" },
    });
    expect(await startWritingEmail({ id: "app-1" })).toEqual(first);
  });

  it("needs an AI provider and the application", async () => {
    expect(await startWritingEmail({ id: "gone" })).toEqual({ ok: false, error: "That application no longer exists." });
    ai.ready = false;
    expect(await startWritingEmail({ id: "app-1" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs an AI provider/) });
  });

  it("lets the recipient be emptied, but nothing else", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: email } });
    expect(await saveUnit({ id: "app-1", document: "EMAIL", unitId: "to", text: "  ", expected: "john@example.com" })).toMatchObject({ ok: true });
    expect(await saved()).toMatchObject([{ id: "to", text: "" }, { id: "subject" }, { id: "body" }]);
    expect(await saveUnit({ id: "app-1", document: "EMAIL", unitId: "subject", text: "", expected: "Application" })).toMatchObject({ ok: false });
  });

  it("puts back the email a rewrite replaced, with a version", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: rewritten } });
    const job = await finishedRewrite({ units: rewritten, previous: email });
    expect(await undoEmailRewrite({ id: "app-1", jobId: job.id })).toEqual({ ok: true, data: null });
    expect(await saved()).toEqual(email);
    expect(await prisma().documentVersion.findMany({ select: { cause: true } })).toEqual([{ cause: "UNDONE" }]);
  });

  it("never undoes over a change made since, or a first email", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: email } });
    const changed = await finishedRewrite({ units: rewritten, previous: email });
    expect(await undoEmailRewrite({ id: "app-1", jobId: changed.id })).toMatchObject({ ok: false, error: expect.stringMatching(/changed since/) });
    const first = await finishedRewrite({ units: email, previous: null });
    expect(await undoEmailRewrite({ id: "app-1", jobId: first.id })).toEqual({ ok: false, error: "There's nothing to undo." });
    expect(await saved()).toEqual(email);
  });
});
