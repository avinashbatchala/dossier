import { loadProfileSettings, saveProfileSettings } from "@/lib/profiles";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageLevel } from "@/generated/prisma/enums";
import type { ImportedProfile } from "@/lib/profile-import";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { applyImportedProfile } from "./profile-import-apply";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const noDates = { startYear: null, startMonth: null, endYear: null, endMonth: null, current: false };
const imported: ImportedProfile = {
  leftOut: [],
  levels: null,
  basics: { name: "John Doe", city: "Utrecht" },
  skills: [
    { name: "figma", found: true },
    { name: "User research", found: true },
  ],
  languages: [
    { name: "dutch", level: LanguageLevel.NATIVE, levelGiven: true },
    { name: "German", level: LanguageLevel.B2, levelGiven: false },
  ],
  experience: [
    { role: "Design Lead", company: "Acme Payments", location: "", descriptor: "Payouts for marketplaces", volunteering: false, bullets: "Led the payout redesign", skills: ["User research"], startYear: 2021, startMonth: 3, endYear: null, endMonth: null, current: true, unverified: [] },
    { role: "Product designer", company: "fieldnote", location: "Amsterdam", descriptor: "", volunteering: true, bullets: "", skills: ["figma"], ...noDates, unverified: [] },
  ],
  projects: [
    { name: "payout simulator", link: "github.com/john/payout-sim", bullets: "", skills: ["User research"], ...noDates, unverified: [] },
    { name: "Design tokens CLI", link: "", bullets: "Built a CLI", skills: ["figma"], startYear: 2024, startMonth: null, endYear: null, endMonth: null, current: true, unverified: [] },
  ],
  education: [{ degree: "MSc Interaction Design", school: "TU Delft", notes: "", startYear: 2015, startMonth: null, endYear: 2017, endMonth: null, current: false, unverified: [] }],
  certifications: [
    { name: "certified accessibility specialist", issuer: "", year: null, month: null, expiryYear: 2030, expiryMonth: 1, credentialId: "IDI-99", link: "", unverified: [] },
    { name: "First aid", issuer: "Red Cross", year: 2019, month: null, expiryYear: null, expiryMonth: null, credentialId: "", link: "", unverified: [] },
  ],
  publications: [
    { citation: "Doe, J. (2024). Calm payouts.", link: "https://doi.org/10.5555/1", unverified: [] },
    { citation: "Doe, J. (2025). A new one.", link: "", unverified: [] },
  ],
  references: [{ name: "Jane Doe", relation: "Manager", company: "", email: "jane.doe@example.com", phone: "", unverified: [] }],
};

/** A profile with a name, email, two skills, Dutch at C1, the Fieldnote role and a reference. */
async function existingProfile() {
  await prisma().profileField.createMany({ data: [{ key: "name", value: "John D." }, { key: "email", value: "john@example.com" }] });
  const figma = await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma", sort: 0 } });
  await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Prototyping", sort: 1 } });
  await prisma().language.create({ data: { name: "Dutch", level: LanguageLevel.C1, sort: 0 } });
  await prisma().experience.create({
    data: { profileId: TEST_PROFILE_ID, role: "Product Designer", company: "Fieldnote", bullets: "My own bullets", startYear: 2018, sort: 0, skills: { create: [{ skillId: figma.id }] } },
  });
  await prisma().reference.create({ data: { profileId: TEST_PROFILE_ID, name: "jane doe", relation: "", company: "Fieldnote", sort: 0 } });
  await prisma().project.create({ data: { profileId: TEST_PROFILE_ID, name: "Payout simulator", bullets: "My own project bullets", startYear: 2023, sort: 0 } });
  await prisma().publication.create({ data: { profileId: TEST_PROFILE_ID, citation: "**Doe, J.** (2024). *Calm payouts.*", onResumes: false, sort: 0 } });
  await prisma().certification.create({
    data: { profileId: TEST_PROFILE_ID, name: "Certified Accessibility Specialist", issuer: "Inclusive Design Institute", year: 2022, month: 6, expiryYear: 2028, expiryMonth: 6, onResumes: false, sort: 0 },
  });
}

describe("applyImportedProfile (E4-10)", () => {
  it("merges: the file wins where it says something, the rest is kept and the new is added", async () => {
    await existingProfile();
    await applyImportedProfile(prisma(), TEST_PROFILE_ID, imported, "merge");

    const fields = Object.fromEntries((await prisma().profileField.findMany()).map((field) => [field.key, field.value]));
    expect(fields).toEqual({ name: "John Doe", email: "john@example.com", city: "Utrecht" });
    expect((await prisma().skill.findMany({ orderBy: { sort: "asc" } })).map((skill) => skill.name)).toEqual(["Figma", "Prototyping", "User research"]);
    expect(await prisma().language.findMany({ orderBy: { sort: "asc" }, select: { name: true, level: true } })).toEqual([
      { name: "Dutch", level: LanguageLevel.NATIVE },
      { name: "German", level: LanguageLevel.B2 },
    ]);

    const roles = await prisma().experience.findMany({ orderBy: { sort: "asc" }, include: { skills: { include: { skill: true } } } });
    // Matched regardless of case, the same role takes the file's spelling; its
    // empty bullets and missing dates keep what was there.
    expect(roles.map((role) => [role.role, role.company])).toEqual([
      ["Product designer", "fieldnote"],
      ["Design Lead", "Acme Payments"],
    ]);
    expect(roles[0]).toMatchObject({ location: "Amsterdam", bullets: "My own bullets", startYear: 2018, volunteering: true });
    expect(roles[1]).toMatchObject({ volunteering: false });
    expect(roles[0].skills.map((link) => link.skill.name)).toEqual(["Figma"]);
    expect(roles[1]).toMatchObject({ bullets: "Led the payout redesign", startYear: 2021, startMonth: 3, current: true });
    expect(roles[1].skills.map((link) => link.skill.name)).toEqual(["User research"]);

    // Projects (PRO-13) match by name, like roles by role and company.
    const projects = await prisma().project.findMany({ orderBy: { sort: "asc" }, include: { skills: { include: { skill: true } } } });
    expect(projects.map((project) => project.name)).toEqual(["payout simulator", "Design tokens CLI"]);
    expect(projects[0]).toMatchObject({ link: "github.com/john/payout-sim", bullets: "My own project bullets", startYear: 2023 });
    expect(projects[0].skills.map((link) => link.skill.name)).toEqual(["User research"]);
    expect(projects[1]).toMatchObject({ bullets: "Built a CLI", current: true });
    expect(projects[1].skills.map((link) => link.skill.name)).toEqual(["Figma"]);

    // Publications (#218) match by their text without marks, keep their formatting and switch, and new ones go after.
    expect(await prisma().publication.findMany({ orderBy: { sort: "asc" }, select: { citation: true, link: true, onResumes: true } })).toEqual([
      { citation: "**Doe, J.** (2024). *Calm payouts.*", link: "https://doi.org/10.5555/1", onResumes: false },
      { citation: "Doe, J. (2025). A new one.", link: "", onResumes: true },
    ]);

    // Certifications (#293) match by name; what the file doesn't give, its obtained date included, is kept, and new ones go after.
    expect(
      await prisma().certification.findMany({
        orderBy: { sort: "asc" },
        select: { name: true, issuer: true, year: true, month: true, expiryYear: true, expiryMonth: true, credentialId: true, onResumes: true },
      }),
    ).toEqual([
      { name: "certified accessibility specialist", issuer: "Inclusive Design Institute", year: 2022, month: 6, expiryYear: 2030, expiryMonth: 1, credentialId: "IDI-99", onResumes: false },
      { name: "First aid", issuer: "Red Cross", year: 2019, month: null, expiryYear: null, expiryMonth: null, credentialId: "", onResumes: true },
    ]);

    expect(await prisma().education.count()).toBe(1);
    const references = await prisma().reference.findMany();
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ relation: "Manager", company: "Fieldnote", email: "jane.doe@example.com" });
  });

  it("puts new entries first in a section ordered by hand", async () => {
    await existingProfile();
    await saveProfileSettings(TEST_PROFILE_ID, { experienceOrder: "manual" }, prisma());
    await applyImportedProfile(prisma(), TEST_PROFILE_ID, imported, "merge");
    const roles = await prisma().experience.findMany({ orderBy: { sort: "asc" } });
    expect(roles.map((role) => role.company)).toEqual(["Acme Payments", "fieldnote"]);
  });

  it("replaces: only what the file holds, in date order", async () => {
    await existingProfile();
    await saveProfileSettings(TEST_PROFILE_ID, { experienceOrder: "manual" }, prisma());
    await saveProfileSettings(TEST_PROFILE_ID, { projectOrder: "manual" }, prisma());
    await prisma().profileField.create({ data: { key: "showAge", value: "false" } });
    // A resume's text has no photo, so the profile's stays (#224).
    await prisma().profileField.createMany({ data: [{ key: "photo", value: "data:image/png;base64,iVBORw0KGgo=" }, { key: "photoOnResumes", value: "false" }] });
    await applyImportedProfile(prisma(), TEST_PROFILE_ID, imported, "replace");

    const fields = Object.fromEntries((await prisma().profileField.findMany()).map((field) => [field.key, field.value]));
    // The shared basics take what the file says and keep the rest: other profiles use them too (E24-1).
    expect(fields).toEqual({ name: "John Doe", email: "john@example.com", city: "Utrecht", showAge: "false", photo: "data:image/png;base64,iVBORw0KGgo=", photoOnResumes: "false" });
    expect((await prisma().skill.findMany()).map((skill) => skill.name).sort()).toEqual(["User research", "figma"]);
    expect((await prisma().experience.findMany()).map((role) => role.company).sort()).toEqual(["Acme Payments", "fieldnote"]);
    expect((await loadProfileSettings(TEST_PROFILE_ID, prisma())).experienceOrder).toBe("date");
    expect((await prisma().project.findMany()).map((project) => project.name).sort()).toEqual(["Design tokens CLI", "payout simulator"]);
    expect((await loadProfileSettings(TEST_PROFILE_ID, prisma())).projectOrder).toBe("date");
    expect((await prisma().publication.findMany({ orderBy: { sort: "asc" } })).map((entry) => entry.citation)).toEqual([
      "Doe, J. (2024). Calm payouts.",
      "Doe, J. (2025). A new one.",
    ]);
    expect((await prisma().certification.findMany({ orderBy: { sort: "asc" } })).map((entry) => entry.name)).toEqual(["certified accessibility specialist", "First aid"]);
  });
});

describe("sections the user made (#298)", () => {
  it("stay when the profile is replaced, since a resume can't bring them back", async () => {
    await prisma().customSection.create({ data: { profileId: TEST_PROFILE_ID, id: "s1", title: "Awards", items: { create: { title: "Best Paper" } } } });
    await prisma().experience.create({ data: { profileId: TEST_PROFILE_ID, role: "Old" } });
    await applyImportedProfile(prisma(), TEST_PROFILE_ID, { basics: {}, skills: [], languages: [], experience: [], projects: [], education: [], certifications: [], publications: [], references: [] } as never, "replace");
    expect(await prisma().experience.count()).toBe(0);
    expect(await prisma().customItem.count()).toBe(1);
  });
});
