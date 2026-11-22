import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const {
  applicationProfileId,
  copyProfile,
  deleteProfile,
  listProfiles,
  loadProfileSettings,
  loadSidebarProfiles,
  loadProfileWorkplace,
  markWorkplaceSeen,
  openProfileId,
  profileNamed,
  profileSearchDefaults,
  saveProfileSettings,
  saveProfileWorkplace,
} = await import("./profiles");
const { DEFAULT_WORKPLACE } = await import("./profile-workplace");
const { loadProfile } = await import("./profile-data");
const { loadSettings } = await import("./settings-data");

const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("profiles (E24-2)", () => {
  it("copies a profile with everything that's its own, each row anew, skills still attached", async () => {
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { headline: "Product Designer", summary: "Calm tools." } });
    const figma = await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma", group: "Tools" } });
    await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, role: "Designer", skills: { create: [{ skillId: figma.id }] } } });
    await prisma().project.create({ data: { profileId: TEST_PROFILE_ID, name: "Tokens", skills: { create: [{ skillId: figma.id }] } } });
    await prisma().education.create({ data: { profileId: TEST_PROFILE_ID, degree: "BA" } });
    await prisma().certification.create({ data: { profileId: TEST_PROFILE_ID, name: "CPACC" } });
    await prisma().publication.create({ data: { profileId: TEST_PROFILE_ID, citation: "Calm payouts" } });
    await prisma().reference.create({ data: { profileId: TEST_PROFILE_ID, name: "Jane" } });
    const awards = await prisma().customSection.create({
      data: { profileId: TEST_PROFILE_ID, title: "Freelance", format: "ENTRIES", countsAs: "WORK_EXPERIENCE", items: { create: { title: "Acme", startYear: 2020 } } },
    });
    await saveProfileSettings(TEST_PROFILE_ID, {
      fitBaseResume: true,
      resumeSections: { order: [`custom:${awards.id}`, "summary"], off: [`custom:${awards.id}`], titles: { [`custom:${awards.id}`]: "Freelance work" } },
    });

    const copyId = await copyProfile(TEST_PROFILE_ID, "Copy");
    const [original, copy] = await Promise.all([loadProfile(TEST_PROFILE_ID), loadProfile(copyId)]);
    expect(copy.basics).toMatchObject({ headline: "Product Designer", summary: "Calm tools." });
    expect(copy.skills.map(({ name, group }) => ({ name, group }))).toEqual([{ name: "Figma", group: "Tools" }]);
    expect(copy.skills[0].id).not.toBe(original.skills[0].id);
    expect(copy.experience[0].skillIds).toEqual([copy.skills[0].id]);
    expect(copy.projects[0].skillIds).toEqual([copy.skills[0].id]);
    expect([copy.education.length, copy.certifications.length, copy.publications.length, copy.references.length]).toEqual([1, 1, 1, 1]);
    expect(copy.customSections).toEqual([expect.objectContaining({ title: "Freelance", countsAs: "WORK_EXPERIENCE", items: [expect.objectContaining({ title: "Acme", startYear: 2020 })] })]);
    const copiedSection = copy.customSections[0].id;
    expect(copiedSection).not.toBe(awards.id);
    // Its Base resume's order and headings point at its own sections.
    expect(await loadProfileSettings(copyId)).toMatchObject({
      fitBaseResume: true,
      resumeSections: { order: [`custom:${copiedSection}`, "summary"], off: [`custom:${copiedSection}`], titles: { [`custom:${copiedSection}`]: "Freelance work" } },
    });
    // Changing the copy leaves the original alone.
    await prisma().experience.updateMany({ where: { profileId: copyId }, data: { role: "Lead Designer" } });
    expect((await loadProfile(TEST_PROFILE_ID)).experience[0].role).toBe("Designer");
    expect((await listProfiles()).map((profile) => profile.name)).toEqual(["My profile", "Copy"]);
  });

  it("keeps the order of custom sections and their items in a copy", async () => {
    // Made in the opposite order to their dates, so the rows come back in an order the copy mustn't follow.
    const day = (n: number) => new Date(`2026-01-0${n}T00:00:00Z`);
    await prisma().customSection.create({ data: { profileId: TEST_PROFILE_ID, title: "Leadership", createdAt: day(2) } });
    await prisma().customSection.create({
      data: {
        profileId: TEST_PROFILE_ID,
        title: "Achievements",
        createdAt: day(1),
        items: { create: [{ title: "Finalist", createdAt: day(4) }, { title: "Winner", createdAt: day(3) }] },
      },
    });

    const copy = await loadProfile(await copyProfile(TEST_PROFILE_ID, "Copy"));
    expect(copy.customSections.map((section) => section.title)).toEqual(["Achievements", "Leadership"]);
    expect(copy.customSections[0].items.map((item) => item.title)).toEqual(["Winner", "Finalist"]);
  });

  it("starts where to work at the defaults, unseen, and keeps the answers and that they were seen (E24-4)", async () => {
    const { DEFAULT_WORKPLACE } = await import("./profile-workplace");
    expect(await loadProfileWorkplace(TEST_PROFILE_ID)).toEqual({ workplace: DEFAULT_WORKPLACE, seen: false });
    await markWorkplaceSeen(TEST_PROFILE_ID);
    expect((await loadProfileWorkplace(TEST_PROFILE_ID)).seen).toBe(true);
    const remote = { ...DEFAULT_WORKPLACE, modes: ["REMOTE" as const], remoteOpenTo: "anywhere" as const, relocate: true, relocatePlaces: ["Canada"] };
    expect(await saveProfileWorkplace(TEST_PROFILE_ID, remote)).toBe(true);
    const copyId = await copyProfile(TEST_PROFILE_ID, "Copy");
    expect(await loadProfileWorkplace(copyId)).toEqual({ workplace: remote, seen: true });
  });

  it("deletes a profile with its own rows, but never the last one", async () => {
    expect(await deleteProfile(TEST_PROFILE_ID)).toBe("last");
    const other = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    await prisma().skill.create({ data: { profileId: other.id, name: "Go" } });
    expect(await deleteProfile(other.id)).toBe("deleted");
    expect(await deleteProfile(other.id)).toBe("gone");
    expect(await prisma().skill.count()).toBe(0);
  });

  it("opens the profile asked for and remembers it, else the last one opened, else the first", async () => {
    const other = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    expect(await openProfileId()).toBe(TEST_PROFILE_ID);
    expect(await openProfileId(other.id)).toBe(other.id);
    expect((await loadSettings()).openProfileId).toBe(other.id);
    expect(await openProfileId()).toBe(other.id);
    expect(await openProfileId("gone")).toBe(other.id);
    await prisma().profile.delete({ where: { id: other.id } });
    expect(await openProfileId()).toBe(TEST_PROFILE_ID);
  });

  it("moves a deleted profile's agent searches to the first of the others, and leaves its applications without one (E24-6)", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend", sort: 1 } });
    const search = await prisma().agentSearch.create({ data: { name: "Go", query: {}, profileId: backend.id } });
    const application = await prisma().application.create({ data: { title: "Go at Acme", profileId: backend.id } });
    expect(await applicationProfileId(application.id)).toBe(backend.id);

    expect(await deleteProfile(backend.id)).toBe("deleted");
    expect((await prisma().agentSearch.findUniqueOrThrow({ where: { id: search.id } })).profileId).toBe(TEST_PROFILE_ID);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).profileId).toBeNull();
    expect(await applicationProfileId(application.id)).toBe(TEST_PROFILE_ID);
  });
});

describe("a profile for the connector and agent searches (E24-6)", () => {
  it("finds a profile by id or by name in any case, the first when none is asked for", async () => {
    const backend = await prisma().profile.create({ data: { name: "Backend ", sort: 1 } });
    expect(await profileNamed(undefined)).toEqual({ id: TEST_PROFILE_ID, name: "My profile" });
    expect(await profileNamed(" ")).toEqual({ id: TEST_PROFILE_ID, name: "My profile" });
    expect(await profileNamed("BACKEND")).toEqual({ id: backend.id, name: "Backend " });
    expect(await profileNamed(backend.id)).toEqual({ id: backend.id, name: "Backend " });
    expect(await profileNamed("Frontend")).toEqual({ error: `There's no profile called "Frontend". The profiles are: "My profile", "Backend ".` });
  });

  it("starts an agent search with the profile's levels, the shared city and country, its radius and Remote only", async () => {
    await prisma().profileField.createMany({
      data: [
        { key: "city", value: "Berlin" },
        { key: "country", value: "Germany" },
      ],
    });
    expect(await profileSearchDefaults(TEST_PROFILE_ID)).toEqual({ experience: "mid", experienceTo: "senior", place: "Berlin", country: "de", radiusKm: 50, remoteOnly: false });

    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { levelFrom: "lead", levelTo: "lead" } });
    await saveProfileWorkplace(TEST_PROFILE_ID, { ...DEFAULT_WORKPLACE, modes: ["HYBRID"], radiusKm: 25 });
    expect(await profileSearchDefaults(TEST_PROFILE_ID)).toEqual({ experience: "lead", experienceTo: undefined, place: "Berlin", country: "de", radiusKm: 25, remoteOnly: false });

    await saveProfileWorkplace(TEST_PROFILE_ID, { ...DEFAULT_WORKPLACE, modes: ["REMOTE"] });
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { levelFrom: null, levelTo: null } });
    expect(await profileSearchDefaults(TEST_PROFILE_ID)).toEqual({ experience: "any", experienceTo: undefined, place: "", country: "de", radiusKm: null, remoteOnly: true });
  });
});

describe("the sidebar's profiles (E27-5)", () => {
  it("gives each profile its own strength, over the shared basics", async () => {
    for (const [key, value] of Object.entries({ name: "Jane Doe", email: "jane@example.com", city: "Rotterdam", country: "Netherlands" })) {
      await prisma().profileField.create({ data: { key, value } });
    }
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { name: "Product design", headline: "Designer", summary: "Calm tools." } });
    await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, role: "Designer" } });
    await prisma().education.create({ data: { profileId: TEST_PROFILE_ID, degree: "BA" } });
    await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma" } });
    const other = await prisma().profile.create({ data: { name: "Service design", sort: 1 } });
    // Volunteering alone isn't a paid role (#294).
    await prisma().experience.create({ data: { profileId: other.id, role: "Helper", volunteering: true } });

    expect(await loadSidebarProfiles()).toEqual([
      { id: TEST_PROFILE_ID, name: "Product design", strength: 100 },
      // Four of six basics (no headline or summary of its own): 4 / 6 × 40.
      { id: other.id, name: "Service design", strength: 27 },
    ]);
  });
});
