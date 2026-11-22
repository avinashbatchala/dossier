import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentKind } from "@/generated/prisma/enums";
import { demoProfile } from "@/lib/demo-profile";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";

import { loadDocuments } from "./application-documents";
import { freezeSentApplications, frozenCopySchema, profileOfApplication, readFrozenCopy, withSectionFromProfile } from "./frozen-copy";
import type { ProfileData } from "./profile";
import { loadProfile } from "./profile-data";
import { applyStatusChange, undoStatusChange } from "./status-changes";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));
const prisma = () => db.client!;

afterAll(() => prisma().$disconnect());

const frozenOf = async (id: string) => (await prisma().application.findUniqueOrThrow({ where: { id }, select: { frozen: true, sections: true } }));

function demoWithoutPhoto() {
  const profile: Partial<ProfileData> = demoProfile();
  delete profile.photo;
  return profile as Omit<ProfileData, "photo">;
}

/** An application with a resume holding one role, from a profile with that role. */
async function draft(status: "DRAFT" | "SENT" = "DRAFT", sentAt: Date | null = null) {
  const { id } = await prisma().application.create({
    data: {
      company: "Ledgerly",
      status,
      sentAt,
      documents: {
        create: [
          { kind: DocumentKind.RESUME, themeId: "classic", units: [{ id: "summary", label: "Summary", text: "Hello" }, { id: "experience:e1", label: "Northwind role", text: "Led the portal" }] },
          { kind: DocumentKind.COVER_LETTER, themeId: "classic", units: [] },
        ],
      },
    },
  });
  return id;
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await prisma().profileField.create({ data: { key: "name", value: "Jane" } });
  await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, id: "e1", role: "Designer", company: "Northwind", startYear: 2020 } });
});

describe("the first send (#299)", () => {
  it("keeps the resume as it was sent when the profile, theme and settings change", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "SENT");

    await prisma().experience.update({ where: { id: "e1" }, data: { role: "Changed", company: "Elsewhere" } });
    await prisma().profileField.update({ where: { key: "name" }, data: { value: "Changed" } });
    await prisma().setting.createMany({
      data: [
        { key: "paper", value: "LETTER" },
        { key: "resumeSections", value: JSON.stringify({ order: ["skills"], off: ["experience"] }) },
      ],
    });
    await prisma().document.updateMany({ where: { applicationId: id }, data: { themeId: "modern" } });

    const { profile, settings, resume, sections, sent } = await loadDocuments(id);
    expect(sent).toBe(true);
    expect(profile.basics.name).toBe("Jane");
    expect(profile.experience[0]).toMatchObject({ role: "Designer", company: "Northwind" });
    expect(settings.paper).toBe("A4");
    expect(resume?.theme.id).toBe("classic");
    expect(sections.off).toEqual([]);
  });

  it("keeps a role that's deleted from the profile", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "SENT");
    await prisma().experience.delete({ where: { id: "e1" } });
    expect((await loadDocuments(id)).profile.experience.map((entry) => entry.id)).toEqual(["e1"]);
  });

  it("leaves a draft following the profile", async () => {
    const id = await draft();
    await prisma().experience.update({ where: { id: "e1" }, data: { role: "Changed" } });
    const { profile, sent } = await loadDocuments(id);
    expect(sent).toBe(false);
    expect(profile.experience[0].role).toBe("Changed");
  });

  it("doesn't freeze a draft that's declined, which was never sent", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "DECLINED");
    expect((await frozenOf(id)).frozen).toBeNull();
  });

  it("freezes on any status past Draft, such as straight to Interview", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "INTERVIEW");
    expect((await frozenOf(id)).frozen).not.toBeNull();
  });

  it("stays frozen when moved back to Draft by hand, and doesn't copy again when sent again", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "SENT");
    await applyStatusChange(prisma(), id, "DRAFT");
    await prisma().experience.update({ where: { id: "e1" }, data: { role: "Changed" } });
    expect((await loadDocuments(id)).profile.experience[0].role).toBe("Designer");
    await applyStatusChange(prisma(), id, "SENT");
    expect((await loadDocuments(id)).profile.experience[0].role).toBe("Designer");
  });

  it("is lifted by undoing the send, back to following the base resume's sections", async () => {
    const id = await draft();
    const change = await applyStatusChange(prisma(), id, "SENT");
    if (change.outcome !== "changed") throw new Error("not changed");
    expect((await frozenOf(id)).sections).not.toBeNull();
    await undoStatusChange(prisma(), change.event.id);
    expect(await frozenOf(id)).toEqual({ frozen: null, sections: null });
  });

  it("keeps a resume's own sections through undoing the send", async () => {
    const id = await draft();
    const own = { order: ["skills"], off: ["summary"] };
    await prisma().application.update({ where: { id }, data: { sections: own } });
    const change = await applyStatusChange(prisma(), id, "SENT");
    if (change.outcome !== "changed") throw new Error("not changed");
    await undoStatusChange(prisma(), change.event.id);
    expect(await frozenOf(id)).toEqual({ frozen: null, sections: own });
  });

  it("isn't lifted by undoing a later change", async () => {
    const id = await draft();
    await applyStatusChange(prisma(), id, "SENT");
    const change = await applyStatusChange(prisma(), id, "SCREENING");
    if (change.outcome !== "changed") throw new Error("not changed");
    await undoStatusChange(prisma(), change.event.id);
    expect((await frozenOf(id)).frozen).not.toBeNull();
  });

  it("leaves the photo out of the copy", async () => {
    await prisma().profileField.create({ data: { key: "photo", value: `data:image/jpeg;base64,${"a".repeat(100)}` } });
    const id = await draft();
    await applyStatusChange(prisma(), id, "SENT");
    expect(JSON.stringify((await frozenOf(id)).frozen)).not.toContain("data:image");
  });
});

describe("freezeSentApplications (#299)", () => {
  it("freezes applications sent before the upgrade, once, with today's order", async () => {
    const sent = await draft("SENT", new Date());
    const own = await draft("SENT", new Date());
    await prisma().application.update({ where: { id: own }, data: { sections: { order: ["skills"], off: [] } } });
    const open = await draft();

    expect(await freezeSentApplications()).toBe(2);
    expect((await frozenOf(sent)).frozen).not.toBeNull();
    expect((await frozenOf(sent)).sections).toMatchObject({ order: expect.arrayContaining(["summary"]) });
    expect((await frozenOf(own)).sections).toEqual({ order: ["skills"], off: [] });
    expect((await frozenOf(open)).frozen).toBeNull();

    await prisma().experience.update({ where: { id: "e1" }, data: { role: "Changed" } });
    expect(await freezeSentApplications()).toBe(0);
    expect((await loadDocuments(sent)).profile.experience[0].role).toBe("Designer");
  });
});

describe("a copy (#299)", () => {
  it("holds the whole profile but the photo, unchanged", () => {
    const profile = demoWithoutPhoto();
    const copy = { profile, themes: { RESUME: null, COVER_LETTER: null }, paper: "A4", dateFormat: "NUMERIC", includeReferences: false, followedBase: true };
    expect(frozenCopySchema.safeParse(JSON.parse(JSON.stringify(copy))).data?.profile).toEqual(profile);
  });

  it("is what the AI reads for a sent application, and the profile for one that isn't (Regenerate, the refine chat)", async () => {
    const id = await draft();
    expect((await profileOfApplication(null)).experience[0].role).toBe("Designer");
    await applyStatusChange(prisma(), id, "SENT");
    await prisma().experience.update({ where: { id: "e1" }, data: { role: "Changed" } });
    expect((await profileOfApplication((await frozenOf(id)).frozen)).experience[0].role).toBe("Designer");
    expect((await profileOfApplication(null)).experience[0].role).toBe("Changed");
  });

  it("reads one made before a field existed, with the field's default", () => {
    const copy = readFrozenCopy({
      profile: { basics: { name: "Jane" }, experience: [{ id: "e1", role: "Designer" }] },
      themes: { RESUME: null, COVER_LETTER: { id: "old", unknown: true } },
      paper: "A4",
      dateFormat: "NUMERIC",
      includeReferences: false,
      followedBase: false,
    });
    expect(copy?.profile.basics).toMatchObject({ name: "Jane", summary: "", showAge: false });
    expect(copy?.profile.experience[0]).toMatchObject({ company: "", volunteering: false, startYear: null, skillIds: [] });
    expect(copy?.profile.customSections).toEqual([]);
    // A theme that no longer reads gives way to the document's.
    expect(copy?.themes.COVER_LETTER).toBeNull();
  });
});

describe("withSectionFromProfile (#299)", () => {
  const base = () => {
    const profile = demoWithoutPhoto();
    return { profile, themes: { RESUME: null, COVER_LETTER: null }, paper: "A4" as const, dateFormat: "NUMERIC" as const, includeReferences: false, followedBase: false };
  };

  it("brings in one section and leaves the rest as sent", () => {
    const copy = base();
    const live = { ...demoProfile(), certifications: [], publications: [{ id: "n", citation: "New", link: "", onResumes: true }], basics: { ...demoProfile().basics, name: "Changed" } };
    const next = withSectionFromProfile(copy, live, "publications");
    expect(next.profile.publications.map((entry) => entry.id)).toEqual(["n"]);
    expect(next.profile.certifications).toEqual(copy.profile.certifications);
    expect(next.profile.basics.name).toBe(copy.profile.basics.name);
  });

  it("brings in a custom section, and replaces it if it had an older one", () => {
    const section = { id: "s1", title: "Awards", format: "LINES" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [] };
    const copy = base();
    const once = withSectionFromProfile(copy, { ...demoProfile(), customSections: [section] }, "custom:s1");
    expect(once.profile.customSections).toEqual([section]);
    const twice = withSectionFromProfile(once, { ...demoProfile(), customSections: [{ ...section, title: "Honours" }] }, "custom:s1");
    expect(twice.profile.customSections.map((entry) => entry.title)).toEqual(["Honours"]);
  });

  it("brings the skills a section's projects name, without touching those it has", () => {
    const copy = base();
    const skill = { id: "new-skill", name: "Rust", group: "" };
    const live = { ...demoProfile(), skills: [...demoProfile().skills, skill], projects: [{ ...demoProfile().projects[0], skillIds: ["new-skill"] }] };
    const next = withSectionFromProfile(copy, live, "projects");
    expect(next.profile.skills.at(-1)).toEqual(skill);
    expect(next.profile.skills).toHaveLength(copy.profile.skills.length + 1);
  });
});

it("loads the profile through a transaction too", async () => {
  const profile = await prisma().$transaction((tx) => loadProfile(null, tx));
  expect(profile.experience.map((entry) => entry.id)).toEqual(["e1"]);
});
