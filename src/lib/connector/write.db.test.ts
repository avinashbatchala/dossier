import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { reviseWrittenApplication, saveWrittenApplication, WRITTEN_IN_CLAUDE, type WrittenApplication } from "./write";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const loaded = vi.hoisted(() => ({ profileIds: [] as (string | null | undefined)[] }));
vi.mock("@/lib/profile-data", async (importOriginal) => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return {
    ...(await importOriginal<typeof import("@/lib/profile-data")>()),
    loadProfile: async (profileId?: string | null) => {
      loaded.profileIds.push(profileId);
      return demoProfile();
    },
  };
});

const prisma = () => db.client!;
const profile = demoProfile();
const role = profile.experience[0];

const written = (overrides: Partial<WrittenApplication> = {}): WrittenApplication => ({
  posting: "Senior Product Designer at Acme, Berlin. Figma, design systems, 5+ years.",
  postingUrl: "https://jobs.example/acme-design",
  postingId: null,
  details: { company: "Acme", role: "Senior Product Designer", location: "Berlin", mode: "Hybrid", salary: "", deadline: null, language: "English" },
  resume: {
    summary: "Designer who ships calm, clear products.",
    roles: [
      { id: role.id, bullets: ["Led the redesign of the payments flow"] },
      { id: "made-up", bullets: ["Invented role"] },
    ],
    projects: [],
    skills: [profile.skills[0].name, "Not a skill of theirs"],
    education: [],
  },
  letter: {
    recipient: "Acme · Hiring team\nBerlin",
    greeting: "Dear Acme team,",
    paragraphs: [
      { label: "Why Acme", text: "Dear Acme team,\nI'd like to help Acme design its product." },
      { label: "", text: "Let's talk.\nWarm regards,\nJane" },
    ],
    sign_off: "",
  },
  match: [{ requirement: "Design systems", result: "gap", note: "Not in the profile" }],
  note: "",
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await saveSettings({ strict: false });
});
afterAll(() => prisma().$disconnect());

describe("an application written in Claude chat (#221)", () => {
  it("is saved as a Draft with its resume and cover letter, by the profile's own ids", async () => {
    const { applicationId } = await saveWrittenApplication(written());
    const application = await prisma().application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { documents: { select: { kind: true, units: true, writtenWith: true } } },
    });
    expect(application).toMatchObject({ status: "DRAFT", company: "Acme", role: "Senior Product Designer", location: "Berlin", postingUrl: "https://jobs.example/acme-design" });

    const resume = application.documents.find((document) => document.kind === "RESUME")!;
    const units = resume.units as { id: string; text: string }[];
    expect(resume.writtenWith).toBe(WRITTEN_IN_CLAUDE);
    expect(units.find((unit) => unit.id === `experience:${role.id}`)?.text).toBe("Led the redesign of the payments flow");
    // Only the profile's own roles and skills, and its publications word for word.
    expect(units.some((unit) => unit.id === "experience:made-up")).toBe(false);
    expect(units.find((unit) => unit.id === "skills")?.text).toBe(profile.skills[0].name);
    const shown = profile.publications.filter((entry) => entry.onResumes);
    expect(units.filter((unit) => unit.id.startsWith("publication:")).map((unit) => unit.text)).toEqual(shown.map((entry) => entry.citation));

    const letter = application.documents.find((document) => document.kind === "COVER_LETTER")!.units as { id: string; text: string }[];
    expect(letter.find((unit) => unit.id === "greeting")?.text).toBe("Dear Acme team,");
    // The greeting and sign-off belong to the frame, not the paragraphs.
    expect(letter.find((unit) => unit.id === "paragraph:1")?.text).toBe("I'd like to help Acme design its product.");
    expect(letter.find((unit) => unit.id === "paragraph:2")?.text).toBe("Let's talk.");
    expect(letter.some((unit) => unit.id === "sender")).toBe(true);
  });

  it("marks names and numbers the profile and posting don't back when Never invent experience is on", async () => {
    await saveSettings({ strict: true });
    const { unverified } = await saveWrittenApplication(written({ resume: { ...written().resume, summary: "Led 40 engineers at Google." } }));
    expect(unverified.find((entry) => entry.part === "Summary")?.items.join(" ")).toMatch(/Google|40/);
  });

  it("shows the posting from Find jobs as applied for", async () => {
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "acme-1", title: "Designer", company: "Acme", url: "https://jobs.example/acme-design" } });
    const { applicationId } = await saveWrittenApplication(written({ postingId: posting.id }));
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).applicationId).toBe(applicationId);
  });
});

describe("a Draft revised in Claude chat (public issue 116)", () => {
  const units = async (applicationId: string, kind: "RESUME" | "COVER_LETTER") =>
    (await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId, kind } } })).units as { id: string; text: string }[];

  it("replaces only the parts given, as a version of its own", async () => {
    const { applicationId } = await saveWrittenApplication(written());
    const letterBefore = await units(applicationId, "COVER_LETTER");

    const revised = await reviseWrittenApplication(applicationId, {
      resume: { ...written().resume, roles: [{ id: role.id, bullets: ["Redesigned the payments flow"] }] },
      change: "Shorter first bullet",
    });

    expect(revised).toEqual({ unverified: [] });
    expect((await units(applicationId, "RESUME")).find((unit) => unit.id === `experience:${role.id}`)?.text).toBe("Redesigned the payments flow");
    expect(await units(applicationId, "COVER_LETTER")).toEqual(letterBefore);
    expect(await prisma().application.count()).toBe(1);
    const newest = await prisma().documentVersion.findFirstOrThrow({ where: { document: { applicationId, kind: "RESUME" } }, orderBy: { createdAt: "desc" } });
    expect(newest).toMatchObject({ cause: "REFINED", detail: "Shorter first bullet" });
  });

  it("keeps the letter's sender, date and signature, and its greeting when none is written", async () => {
    const { applicationId } = await saveWrittenApplication(written());
    const before = await units(applicationId, "COVER_LETTER");

    await reviseWrittenApplication(applicationId, {
      letter: { recipient: "", greeting: "", paragraphs: [{ label: "", text: "A new first line." }], sign_off: "" },
      change: "New first line",
    });

    const after = await units(applicationId, "COVER_LETTER");
    for (const id of ["sender", "date", "greeting", "signature"]) expect(after.find((unit) => unit.id === id)).toEqual(before.find((unit) => unit.id === id));
    expect(after.filter((unit) => unit.id.startsWith("paragraph:")).map((unit) => unit.text)).toEqual(["A new first line."]);
  });

  it("marks names and numbers the profile and posting don't back when Never invent experience is on", async () => {
    const { applicationId } = await saveWrittenApplication(written());
    await saveSettings({ strict: true });
    const revised = await reviseWrittenApplication(applicationId, { resume: { ...written().resume, summary: "Led 40 engineers at Google." }, change: "New summary" });
    expect("unverified" in revised && revised.unverified.find((entry) => entry.part === "Summary")?.items.join(" ")).toMatch(/Google|40/);
  });

  it("reads the profile the application was written from", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    const { applicationId } = await saveWrittenApplication(written({ profileId: backend.id }));
    loaded.profileIds = [];
    await reviseWrittenApplication(applicationId, { resume: written().resume, change: "New summary" });
    expect(loaded.profileIds).toEqual([backend.id]);
  });

  it("refuses an application that was sent", async () => {
    const { applicationId } = await saveWrittenApplication(written());
    await prisma().application.update({ where: { id: applicationId }, data: { status: "SENT" } });
    const resumeBefore = await units(applicationId, "RESUME");

    const revised = await reviseWrittenApplication(applicationId, { resume: { ...written().resume, summary: "Something else." }, change: "New summary" });

    expect(revised).toMatchObject({ error: expect.stringMatching(/Only a Draft/) });
    expect(await units(applicationId, "RESUME")).toEqual(resumeBefore);
  });
});
