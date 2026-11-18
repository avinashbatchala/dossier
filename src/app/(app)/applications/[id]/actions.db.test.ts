import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfileSettings } from "@/lib/profiles";

import { applyStatusChange } from "@/lib/status-changes";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import {
  addApplicationSection,
  addMatchSkill,
  addNote,
  forgetKnownGap,
  markKnownGap,
  deleteNote,
  followBaseSections,
  leaveOutUnit,
  listVersions,
  loadVersion,
  putBackTrimmed,
  restoreNote,
  restoreUnit,
  restoreVersion,
  goBackTo,
  saveUnit,
  sendMessage,
  setApplicationSections,
  setApplicationTheme,
  setFollowThemeLayout,
  setInterviewDate,
  startPreparing,
  tickPrep,
  updateInterview,
  addInterviewRound,
  saveOffer,
  startWritingMessage,
  saveMessageDraft,
  markMessageSent,
  setShowPhoto,
  startRegenerating,
  startWritingEmail,
  undoEmailRewrite,
  undoMessage,
  undoUpdateFromProfile,
  updateFromProfile,
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

describe("an application's sections (#297)", () => {
  const sectionsOf = async () => (await prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, select: { sections: true } })).sections;
  const unitsOf = async () =>
    (await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } }, select: { units: true } })).units as { id: string; text: string }[];

  it("follows the base resume until it has its own order, and can go back", async () => {
    expect(await sectionsOf()).toBeNull();
    const order = ["skills", "summary"];
    expect(await setApplicationSections({ id: "app-1", order, off: ["projects"] })).toEqual({ ok: true, data: null });
    expect(await sectionsOf()).toEqual({ order, off: ["projects"] });
    await followBaseSections({ id: "app-1" });
    expect(await sectionsOf()).toBeNull();
  });

  it("keeps the headings it renamed (#339)", async () => {
    await setApplicationSections({ id: "app-1", order: ["summary"], off: [], titles: { experience: "Relevant experience" } });
    expect(await sectionsOf()).toEqual({ order: ["summary"], off: [], titles: { experience: "Relevant experience" } });
  });

  it("adds a section in the profile's own words, keeping what's there", async () => {
    await prisma().certification.create({ data: { profileId: TEST_PROFILE_ID, id: "c1", name: "Accessibility Specialist" } });
    expect(await addApplicationSection({ id: "app-1", key: "certifications" })).toEqual({ ok: true, data: null });
    const units = await unitsOf();
    expect(units.find((unit) => unit.id === "certification:c1")?.text).toBe("Accessibility Specialist");
    expect(units.find((unit) => unit.id === "summary")?.text).toBe("Calm tools for complex work.");
    // It didn't need an order of its own for that.
    expect(await sectionsOf()).toBeNull();
  });

  it("adds a section the resume removed, by turning it back on", async () => {
    await setApplicationSections({ id: "app-1", order: [], off: ["summary", "skills"] });
    await addApplicationSection({ id: "app-1", key: "summary" });
    expect(await sectionsOf()).toEqual({ order: [], off: ["skills"] });
    expect((await unitsOf()).find((unit) => unit.id === "summary")?.text).toBe("Calm tools for complex work.");
  });

  it("adds references by hand, whatever the setting says", async () => {
    await addApplicationSection({ id: "app-1", key: "references" });
    expect(await sectionsOf()).toMatchObject({ withReferences: true });
  });

  describe("on a sent resume (#299)", () => {
    const frozenProfile = async () => {
      const { frozen } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, select: { frozen: true } });
      return (frozen as { profile: { certifications: { id: string }[]; basics: { name: string } } }).profile;
    };
    beforeEach(async () => {
      await prisma().profileField.create({ data: { key: "name", value: "Jane" } });
      await applyStatusChange(prisma(), "app-1", "SENT");
      await prisma().certification.create({ data: { profileId: TEST_PROFILE_ID, id: "c1", name: "Specialist" } });
      await prisma().profileField.update({ where: { key: "name" }, data: { value: "Changed" } });
    });

    it("gets a section only by Add, and only that section", async () => {
      expect((await frozenProfile()).certifications).toEqual([]);
      await addApplicationSection({ id: "app-1", key: "certifications" });
      expect((await frozenProfile()).certifications.map((entry) => entry.id)).toEqual(["c1"]);
      expect((await frozenProfile()).basics.name).toBe("Jane");
      expect((await unitsOf()).map((unit) => unit.id)).toContain("certification:c1");
    });

    it("takes a removed section back on without touching its copy", async () => {
      await setApplicationSections({ id: "app-1", order: [], off: ["summary"] });
      await addApplicationSection({ id: "app-1", key: "summary" });
      expect(await sectionsOf()).toEqual({ order: [], off: [] });
    });

    it("takes the base resume's order once, rather than following it", async () => {
      await saveProfileSettings(TEST_PROFILE_ID, { resumeSections: { order: ["skills"], off: [] } }, prisma());
      await followBaseSections({ id: "app-1" });
      expect(await sectionsOf()).toEqual({ order: ["skills"], off: [] });
    });
  });

  describe("Update from profile (#301)", () => {
    const copyName = async () => {
      const { frozen } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, select: { frozen: true } });
      return (frozen as { profile: { basics: { name: string } } } | null)?.profile.basics.name;
    };
    beforeEach(async () => {
      await prisma().profileField.create({ data: { key: "name", value: "Jane" } });
    });

    it("brings the profile in on request, and Undo puts it back", async () => {
      await applyStatusChange(prisma(), "app-1", "SENT");
      await prisma().profileField.update({ where: { key: "name" }, data: { value: "Janet" } });
      expect(await copyName()).toBe("Jane");

      const result = await updateFromProfile({ id: "app-1" });
      expect(await copyName()).toBe("Janet");
      if (!result.ok || !result.data) throw new Error("not updated");
      expect((await unitsOf()).find((unit) => unit.id === "summary")?.text).toBe("Calm tools for complex work.");

      await undoUpdateFromProfile({ id: "app-1", ...result.data });
      expect(await copyName()).toBe("Jane");
    });

    it("says when there's nothing to update", async () => {
      await applyStatusChange(prisma(), "app-1", "SENT");
      expect(await updateFromProfile({ id: "app-1" })).toEqual({ ok: true, data: null });
    });

    it("adds new items to a draft, which has no copy", async () => {
      await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, id: "e1", role: "Designer", company: "Northwind", startYear: 2020 } });
      await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, id: "e2", role: "Lead", company: "Acme", startYear: 2024, bullets: "Built the team" } });
      const result = await updateFromProfile({ id: "app-1" });
      if (!result.ok || !result.data) throw new Error("not updated");
      expect(result.data.profile).toBeNull();
      expect((await unitsOf()).find((unit) => unit.id === "experience:e2")?.text).toBe("Built the team");
      await undoUpdateFromProfile({ id: "app-1", ...result.data });
      expect((await unitsOf()).map((unit) => unit.id)).not.toContain("experience:e2");
    });

    it("refuses an application that's gone", async () => {
      expect(await updateFromProfile({ id: "gone" })).toMatchObject({ ok: false });
    });
  });

  it("takes an added part off the list of what was left out", async () => {
    await prisma().certification.create({ data: { profileId: TEST_PROFILE_ID, id: "c1", name: "Specialist" } });
    await prisma().document.update({
      where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } },
      data: { trimmed: [{ kind: "unit", unit: { id: "certification:c1", label: "Specialist", text: "Specialist" }, index: 2 }] },
    });
    await addApplicationSection({ id: "app-1", key: "certifications" });
    const row = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } }, select: { trimmed: true } });
    expect(row.trimmed).toBeNull();
  });
});

describe("setApplicationTheme (#226)", () => {
  const themeOf = async () =>
    Object.fromEntries(
      (await prisma().document.findMany({ where: { applicationId: "app-1" }, select: { kind: true, themeId: true } })).map((row) => [row.kind, row.themeId]),
    );

  beforeEach(async () => {
    const font = { headFont: "GARAMOND", bodyFont: "GARAMOND", accent: "#1d1c1a" } as const;
    await prisma().theme.createMany({ data: [{ id: "editorial", name: "Editorial", ...font }, { id: "classic", name: "Classic", ...font }] });
    await prisma().document.updateMany({ where: { applicationId: "app-1" }, data: { themeId: "editorial" } });
    await prisma().document.createMany({
      data: [
        { applicationId: "app-1", kind: "COVER_LETTER", units: [], themeId: null },
        { applicationId: "app-1", kind: "EMAIL", units: [] },
      ],
    });
  });

  it("gives the resume and the cover letter the theme, whatever they had, and leaves their text alone", async () => {
    expect(await setApplicationTheme({ id: "app-1", themeId: "classic" })).toEqual({ ok: true, data: null });
    expect(await themeOf()).toEqual({ RESUME: "classic", COVER_LETTER: "classic", EMAIL: null });
    expect(await units()).toEqual(resume);
  });

  it("says so when the theme or the application is gone", async () => {
    expect(await setApplicationTheme({ id: "app-1", themeId: "deleted" })).toEqual({
      ok: false,
      error: "That theme doesn't exist anymore. Reload the page to see your themes.",
    });
    expect(await setApplicationTheme({ id: "gone", themeId: "classic" })).toEqual({ ok: false, error: "That application no longer exists." });
    expect(await themeOf()).toEqual({ RESUME: "editorial", COVER_LETTER: null, EMAIL: null });
  });
});

describe("setApplicationTheme on a sent resume (#299)", () => {
  it("changes the theme it's drawn in, which editing the theme doesn't", async () => {
    const font = { headFont: "GARAMOND", bodyFont: "GARAMOND", accent: "#1d1c1a" } as const;
    await prisma().theme.createMany({ data: [{ id: "editorial", name: "Editorial", ...font }, { id: "classic", name: "Classic", ...font }] });
    await applyStatusChange(prisma(), "app-1", "SENT");
    await setApplicationTheme({ id: "app-1", themeId: "classic" });
    const { frozen } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, select: { frozen: true } });
    expect(frozen).toMatchObject({ themes: { RESUME: { id: "classic" }, COVER_LETTER: { id: "classic" } } });
  });
});

describe("setShowPhoto (#224)", () => {
  it("saves the photo switch on the application, which follows the profile until then", async () => {
    const showPhoto = async () => (await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).showPhoto;
    expect(await showPhoto()).toBeNull();
    expect(await setShowPhoto({ id: "app-1", show: false })).toEqual({ ok: true, data: null });
    expect(await showPhoto()).toBe(false);
    await setShowPhoto({ id: "app-1", show: true });
    expect(await showPhoto()).toBe(true);
  });

  it("says so when the application is gone", async () => {
    expect(await setShowPhoto({ id: "gone", show: true })).toEqual({ ok: false, error: "That application no longer exists." });
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

  it("leaves a resume's certifications and publications as written (#293, #218)", async () => {
    expect(await startRegenerating({ id: "app-1", document: "RESUME", unitId: "certification:c1" })).toEqual({ ok: false, error: "A certification stays as you wrote it. Edit it instead." });
    expect(await startRegenerating({ id: "app-1", document: "RESUME", unitId: "publication:u1" })).toEqual({ ok: false, error: "A publication stays as you wrote it. Edit it instead." });
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

  it("starts an answer for a question in Ask, about no part, on any tab (E30-10)", async () => {
    const result = await sendMessage({ id: "app-1", text: "What matters most?", viewing: null, target: { document: "RESUME", unitId: "summary" }, mode: "ask" });
    const job = await prisma().job.findUniqueOrThrow({ where: { id: result.ok && result.data.jobId ? result.data.jobId : "" } });
    expect(job.input).toMatchObject({ request: "What matters most?", target: null, viewing: null, mode: "ask" });
    expect((await messages()).map(({ role, text, targetUnit }) => [role, text, targetUnit])).toEqual([["USER", "What matters most?", null]]);
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
    expect(await addMatchSkill({ id: "app-1", index: 0 })).toEqual({ ok: true, data: { name: "Kubernetes", where: "", experienceId: null } });
    expect(await prisma().skill.findMany({ select: { name: true } })).toEqual([{ name: "Kubernetes" }]);
    const { match } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(match).toMatchObject({ items: [{ result: "partial", skill: "Kubernetes", note: "In your skills, but not linked to a role yet" }, { result: "gap" }] });
  });

  it("refuses a requirement that isn't a skill", async () => {
    expect(await addMatchSkill({ id: "app-1", index: 1 })).toMatchObject({ ok: false });
    expect(await prisma().skill.count()).toBe(0);
  });

  it("links it to the role it was used in, with what was done as a new line (E30-5)", async () => {
    const { profileId } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    const role = await prisma().experience.create({ data: { profileId: profileId ?? TEST_PROFILE_ID, company: "Northwind", role: "Designer", bullets: "Led the portal" } });
    const result = await addMatchSkill({ id: "app-1", index: 0, experienceId: role.id, did: " Designed the deploy dashboard " });
    expect(result).toEqual({ ok: true, data: { name: "Kubernetes", where: "Northwind", experienceId: role.id } });
    const skill = await prisma().skill.findFirstOrThrow({ where: { name: "Kubernetes" } });
    expect(await prisma().experienceSkill.findMany()).toEqual([{ experienceId: role.id, skillId: skill.id }]);
    expect((await prisma().experience.findUniqueOrThrow({ where: { id: role.id } })).bullets).toBe("Led the portal\nDesigned the deploy dashboard");
    const { match } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(match).toMatchObject({ items: [{ result: "covered", skill: "Kubernetes", experienceIds: [role.id], note: "At Northwind" }, { result: "gap" }] });
  });

  it("refuses a role from another profile", async () => {
    const other = await prisma().profile.create({ data: { name: "Other" } });
    const role = await prisma().experience.create({ data: { profileId: other.id, company: "Elsewhere" } });
    expect(await addMatchSkill({ id: "app-1", index: 0, experienceId: role.id })).toMatchObject({ ok: false });
    expect(await prisma().skill.count()).toBe(0);
  });

  // The engine's rows (E25-7) don't line up with the extracted requirements (#439).
  describe("in a match from the scoring engine", () => {
    beforeEach(async () => {
      await prisma().application.update({
        where: { id: "app-1" },
        data: {
          match: {
            items: [
              { ...item("Fintech or payments experience", "gap"), mustHave: false, addable: null },
              { ...item("Experience with Docker", "gap"), mustHave: true, addable: "Docker" },
            ],
          },
        },
      });
    });

    it("adds the row's own skill, not the extracted requirement's at that place", async () => {
      expect(await addMatchSkill({ id: "app-1", index: 1 })).toEqual({ ok: true, data: { name: "Docker", where: "", experienceId: null } });
      expect(await prisma().skill.findMany({ select: { name: true } })).toEqual([{ name: "Docker" }]);
      const { match } = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
      expect(match).toMatchObject({ items: [{ result: "gap" }, { result: "partial", skill: "Docker" }] });
    });

    it("refuses a row with nothing to add, even where the extracted list has a skill", async () => {
      expect(await addMatchSkill({ id: "app-1", index: 0 })).toMatchObject({ ok: false });
      expect(await prisma().skill.count()).toBe(0);
    });
  });
});

describe("interviews (E30-6)", () => {
  const rounds = () => prisma().interview.findMany({ where: { applicationId: "app-1" }, orderBy: { round: "asc" } });

  it("fills a round from the interview date", async () => {
    await setInterviewDate({ id: "app-1", at: "2030-12-03T10:00:00.000Z", calendar: false });
    expect((await rounds()).map((round) => [round.round, round.at?.toISOString()])).toEqual([[1, "2030-12-03T10:00:00.000Z"]]);
  });

  it("starts Prepare for the round to come, giving an application without one round 1", async () => {
    const result = await startPreparing({ id: "app-1" });
    const [round] = await rounds();
    expect(round).toMatchObject({ round: 1, at: null });
    const job = await prisma().job.findUniqueOrThrow({ where: { id: result.ok ? result.data : "" } });
    expect(job).toMatchObject({ type: "prepare-interview", key: "prepare:app-1", input: { applicationId: "app-1", interviewId: round.id } });
    // Asking again follows the same job.
    expect(await startPreparing({ id: "app-1" })).toEqual(result);
  });

  it("needs an AI provider for Prepare", async () => {
    ai.ready = false;
    expect(await startPreparing({ id: "app-1" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs an AI provider/) });
  });

  it("ticks an item with when, saves a round's details, and adds the next round once it's past", async () => {
    const round = await prisma().interview.create({ data: { applicationId: "app-1", round: 1, at: new Date("2020-01-01T10:00:00Z"), prep: [{ text: "Reread the posting", why: "From the posting", done: false }] } });
    expect(await tickPrep({ id: "app-1", interviewId: round.id, index: 0, done: true })).toEqual({ ok: true, data: null });
    expect((await rounds())[0].prep).toEqual([{ text: "Reread the posting", why: "From the posting", done: true, doneAt: expect.any(String) }]);
    expect(await tickPrep({ id: "app-1", interviewId: round.id, index: 5, done: true })).toMatchObject({ ok: false });

    await updateInterview({ id: "app-1", interviewId: round.id, minutes: 45, place: "Google Meet", people: "Lotte de Vries", notes: "Went well." });
    expect((await rounds())[0]).toMatchObject({ minutes: 45, place: "Google Meet", people: "Lotte de Vries", notes: "Went well." });

    expect(await addInterviewRound({ id: "app-1" })).toMatchObject({ ok: true, data: { round: 2 } });
    expect(await addInterviewRound({ id: "app-1" })).toMatchObject({ ok: false });
  });
});

describe("the offer and drafted messages (E30-7, E30-8)", () => {
  const application = () => prisma().application.findUniqueOrThrow({ where: { id: "app-1" }, include: { offer: true } });

  it("saves the offer by hand, its dates as calendar days", async () => {
    expect(await saveOffer({ id: "app-1", salary: "€82,000", decideBy: "2026-12-11", startDate: null, holidays: "27 days", office: "Hybrid" })).toEqual({ ok: true, data: null });
    await saveOffer({ id: "app-1", salary: "€85,000", decideBy: "2026-12-11", startDate: "2027-02-01", holidays: "27 days", office: "Hybrid" });
    expect((await application()).offer).toMatchObject({ salary: "€85,000", decideBy: new Date("2026-12-11T00:00:00Z"), startDate: new Date("2027-02-01T00:00:00Z") });
  });

  it("starts a draft on the click, one at a time", async () => {
    const result = await startWritingMessage({ id: "app-1", kind: "accept" });
    const job = await prisma().job.findUniqueOrThrow({ where: { id: result.ok ? result.data : "" } });
    expect(job).toMatchObject({ type: "write-message", key: "message:app-1", input: { applicationId: "app-1", kind: "accept" } });
    expect(await startWritingMessage({ id: "app-1", kind: "decline" })).toMatchObject({ ok: false });
  });

  it("edits a draft, and \"I sent it\" lets it go and restarts Quiet for", async () => {
    const draft = { kind: "follow-up", to: "", subject: "Following up", body: "Hi!", writtenWith: "write-message@1", at: "2026-11-17T10:00:00.000Z" };
    await prisma().application.update({ where: { id: "app-1" }, data: { messageDraft: draft } });
    await saveMessageDraft({ id: "app-1", subject: "Checking in", body: "Hello again." });
    expect((await application()).messageDraft).toEqual({ ...draft, subject: "Checking in", body: "Hello again." });
    expect(await markMessageSent({ id: "app-1" })).toEqual({ ok: true, data: null });
    const after = await application();
    expect(after.messageDraft).toBeNull();
    expect(after.contactedAt).toBeInstanceOf(Date);
  });
});

describe("known gaps (E30-5)", () => {
  it("marks a gap as known once, and Undo forgets it", async () => {
    expect(await markKnownGap({ id: "app-1", requirement: "Experience with Kubernetes" })).toEqual({ ok: true, data: null });
    expect(await markKnownGap({ id: "app-1", requirement: "Experience with Kubernetes" })).toEqual({ ok: true, data: null });
    expect(await prisma().knownGap.findMany({ select: { applicationId: true, requirement: true } })).toEqual([{ applicationId: "app-1", requirement: "Experience with Kubernetes" }]);
    expect(await forgetKnownGap({ id: "app-1", requirement: "Experience with Kubernetes" })).toEqual({ ok: true, data: null });
    expect(await prisma().knownGap.count()).toBe(0);
  });

  it("says so for an application that's gone", async () => {
    expect(await markKnownGap({ id: "gone", requirement: "Kubernetes" })).toMatchObject({ ok: false });
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

describe("leaveOutUnit (#217)", () => {
  const document = () => prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } } });

  it("takes a part off the resume and lists it after what the page limit left out", async () => {
    const earlier = [{ kind: "unit", unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 2 }];
    await prisma().document.updateMany({ where: { applicationId: "app-1" }, data: { trimmed: earlier } });

    expect(await leaveOutUnit({ id: "app-1", unitId: "summary" })).toEqual({ ok: true, data: { index: 1 } });
    const saved = await document();
    expect((saved.units as typeof resume).map((unit) => unit.id)).toEqual(["experience:e1"]);
    expect(saved.trimmed).toEqual([...earlier, { kind: "unit", unit: resume[0], index: 0, byHand: true }]);
  });

  it("is undone by Put back, with the part where it was", async () => {
    await leaveOutUnit({ id: "app-1", unitId: "summary" });
    expect(await putBackTrimmed({ id: "app-1", index: 0 })).toEqual({ ok: true, data: null });
    const saved = await document();
    expect(saved.units).toEqual(resume);
    expect(saved.trimmed).toBeNull();
  });

  it("says so when the part is gone", async () => {
    await leaveOutUnit({ id: "app-1", unitId: "summary" });
    expect(await leaveOutUnit({ id: "app-1", unitId: "summary" })).toMatchObject({ ok: false, error: expect.stringMatching(/^That part of the document no longer exists/) });
    expect((await document()).trimmed).toHaveLength(1);
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

  it("goes back to versions in several documents at once, skipping one that's already so (E30-11)", async () => {
    const { id: documentId } = await document();
    const letterDocument = await prisma().document.create({ data: { applicationId: "app-1", kind: "COVER_LETTER", units: [{ id: "paragraph:1", label: "Opening", text: "Now." }] } });
    const resumeThen = await prisma().documentVersion.create({ data: { documentId, units: resume, cause: "WRITTEN" } });
    const letterThen = await prisma().documentVersion.create({ data: { documentId: letterDocument.id, units: [{ id: "paragraph:1", label: "Opening", text: "Then." }], cause: "WRITTEN" } });
    expect(await goBackTo({ id: "app-1", versionIds: [resumeThen.id, letterThen.id] })).toEqual({ ok: true, data: ["COVER_LETTER"] });
    expect((await prisma().document.findUniqueOrThrow({ where: { id: letterDocument.id } })).units).toEqual([{ id: "paragraph:1", label: "Opening", text: "Then." }]);
    expect(await goBackTo({ id: "app-1", versionIds: [resumeThen.id] })).toEqual({ ok: false, error: "That's how it is now already." });
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
