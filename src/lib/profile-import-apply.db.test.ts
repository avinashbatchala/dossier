import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { LanguageLevel } from "@/generated/prisma/enums";
import type { ImportedProfile } from "@/lib/profile-import";
import { createTestClient, resetDatabase } from "@/test/db";

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
    { role: "Design Lead", company: "Acme Payments", location: "", descriptor: "Payouts for marketplaces", bullets: "Led the payout redesign", skills: ["User research"], startYear: 2021, startMonth: 3, endYear: null, endMonth: null, current: true, unverified: [] },
    { role: "Product designer", company: "fieldnote", location: "Amsterdam", descriptor: "", bullets: "", skills: ["figma"], ...noDates, unverified: [] },
  ],
  projects: [
    { name: "payout simulator", link: "github.com/john/payout-sim", bullets: "", skills: ["User research"], ...noDates, unverified: [] },
    { name: "Design tokens CLI", link: "", bullets: "Built a CLI", skills: ["figma"], startYear: 2024, startMonth: null, endYear: null, endMonth: null, current: true, unverified: [] },
  ],
  education: [{ degree: "MSc Interaction Design", school: "TU Delft", notes: "", startYear: 2015, startMonth: null, endYear: 2017, endMonth: null, current: false, unverified: [] }],
  publications: [
    { citation: "Doe, J. (2024). Calm payouts.", link: "https://doi.org/10.5555/1", unverified: [] },
    { citation: "Doe, J. (2025). A new one.", link: "", unverified: [] },
  ],
  references: [{ name: "Jane Doe", relation: "Manager", company: "", email: "jane.doe@example.com", phone: "", unverified: [] }],
};

/** A profile with a name, email, two skills, Dutch at C1, the Fieldnote role and a reference. */
async function existingProfile() {
  await prisma().profileField.createMany({ data: [{ key: "name", value: "John D." }, { key: "email", value: "john@example.com" }] });
  const figma = await prisma().skill.create({ data: { name: "Figma", sort: 0 } });
  await prisma().skill.create({ data: { name: "Prototyping", sort: 1 } });
  await prisma().language.create({ data: { name: "Dutch", level: LanguageLevel.C1, sort: 0 } });
  await prisma().experience.create({
    data: { role: "Product Designer", company: "Fieldnote", bullets: "My own bullets", startYear: 2018, sort: 0, skills: { create: [{ skillId: figma.id }] } },
  });
  await prisma().reference.create({ data: { name: "jane doe", relation: "", company: "Fieldnote", sort: 0 } });
  await prisma().project.create({ data: { name: "Payout simulator", bullets: "My own project bullets", startYear: 2023, sort: 0 } });
  await prisma().publication.create({ data: { citation: "**Doe, J.** (2024). *Calm payouts.*", onResumes: false, sort: 0 } });
}

describe("applyImportedProfile (E4-10)", () => {
  it("merges: the file wins where it says something, the rest is kept and the new is added", async () => {
    await existingProfile();
    await applyImportedProfile(prisma(), imported, "merge");

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
    expect(roles[0]).toMatchObject({ location: "Amsterdam", bullets: "My own bullets", startYear: 2018 });
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

    expect(await prisma().education.count()).toBe(1);
    const references = await prisma().reference.findMany();
    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({ relation: "Manager", company: "Fieldnote", email: "jane.doe@example.com" });
  });

  it("puts new entries first in a section ordered by hand", async () => {
    await existingProfile();
    await prisma().setting.create({ data: { key: "experienceOrder", value: "manual" } });
    await applyImportedProfile(prisma(), imported, "merge");
    const roles = await prisma().experience.findMany({ orderBy: { sort: "asc" } });
    expect(roles.map((role) => role.company)).toEqual(["Acme Payments", "fieldnote"]);
  });

  it("replaces: only what the file holds, in date order", async () => {
    await existingProfile();
    await prisma().setting.create({ data: { key: "experienceOrder", value: "manual" } });
    await prisma().setting.create({ data: { key: "projectOrder", value: "manual" } });
    await prisma().profileField.create({ data: { key: "showAge", value: "false" } });
    // A resume's text has no photo, so the profile's stays (#224).
    await prisma().profileField.createMany({ data: [{ key: "photo", value: "data:image/png;base64,iVBORw0KGgo=" }, { key: "photoOnResumes", value: "false" }] });
    await applyImportedProfile(prisma(), imported, "replace");

    const fields = Object.fromEntries((await prisma().profileField.findMany()).map((field) => [field.key, field.value]));
    expect(fields).toEqual({ name: "John Doe", city: "Utrecht", showAge: "false", photo: "data:image/png;base64,iVBORw0KGgo=", photoOnResumes: "false" });
    expect((await prisma().skill.findMany()).map((skill) => skill.name).sort()).toEqual(["User research", "figma"]);
    expect((await prisma().experience.findMany()).map((role) => role.company).sort()).toEqual(["Acme Payments", "fieldnote"]);
    expect((await prisma().setting.findUnique({ where: { key: "experienceOrder" } }))?.value).toBe("date");
    expect((await prisma().project.findMany()).map((project) => project.name).sort()).toEqual(["Design tokens CLI", "payout simulator"]);
    expect((await prisma().setting.findUnique({ where: { key: "projectOrder" } }))?.value).toBe("date");
    expect((await prisma().publication.findMany({ orderBy: { sort: "asc" } })).map((entry) => entry.citation)).toEqual([
      "Doe, J. (2024). Calm payouts.",
      "Doe, J. (2025). A new one.",
    ]);
  });
});
