import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("several profiles (E24-1)", () => {
  it("loads one profile's own sections with the shared basics, languages and facts", async () => {
    const { loadProfile } = await import("@/lib/profile-data");
    await db.profile.update({ where: { id: TEST_PROFILE_ID }, data: { headline: "Product Designer" } });
    await db.profile.create({ data: { id: "backend", name: "Backend", sort: 1, headline: "Backend Engineer" } });
    await db.profileField.create({ data: { key: "name", value: "Jane Doe" } });
    await db.language.create({ data: { name: "Dutch", level: "C1" } });
    await db.fact.create({ data: { text: "Moving to Berlin." } });
    await db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma" } });
    await db.skill.create({ data: { profileId: "backend", name: "figma" } });
    await db.experience.create({ data: { profileId: "backend", role: "API Engineer" } });

    const first = await loadProfile(null, db);
    const backend = await loadProfile("backend", db);
    expect(first.basics).toMatchObject({ name: "Jane Doe", headline: "Product Designer" });
    expect(backend.basics).toMatchObject({ name: "Jane Doe", headline: "Backend Engineer" });
    expect(first.experience).toEqual([]);
    expect(backend.experience.map((role) => role.role)).toEqual(["API Engineer"]);
    expect([first.skills.map((skill) => skill.name), backend.skills.map((skill) => skill.name)]).toEqual([["Figma"], ["figma"]]);
    expect([first.languages, backend.languages].map((languages) => languages.map((language) => language.name))).toEqual([["Dutch"], ["Dutch"]]);
    expect(backend.facts.map((fact) => fact.text)).toEqual(["Moving to Berlin."]);
    // A profile that's gone reads as the first.
    expect((await loadProfile("gone", db)).basics.headline).toBe("Product Designer");
  });

  it("deletes a profile's own rows with it", async () => {
    await db.profile.create({ data: { id: "backend", name: "Backend" } });
    await db.skill.create({ data: { profileId: "backend", name: "Go" } });
    await db.customSection.create({ data: { profileId: "backend", title: "Talks", items: { create: { title: "GopherCon" } } } });
    await db.profile.delete({ where: { id: "backend" } });
    expect(await Promise.all([db.skill.count(), db.customSection.count(), db.customItem.count()])).toEqual([0, 0, 0]);
  });
});

describe("profile schema", () => {
  it("keeps one value per profile key", async () => {
    await db.profileField.create({ data: { key: "name", value: "Jane Doe" } });
    await expect(db.profileField.create({ data: { key: "name", value: "Someone else" } })).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
  });

  it("treats skill and language names as unique ignoring case", async () => {
    await db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma" } });
    await expect(db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "figma" } })).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002",
    );
    expect(await db.skill.findUnique({ where: { profileId_name: { profileId: TEST_PROFILE_ID, name: "FIGMA" } } })).toMatchObject({
      name: "Figma",
    });

    await db.language.create({ data: { name: "Dutch", level: "NATIVE" } });
    await expect(db.language.create({ data: { name: "DUTCH", level: "C1" } })).rejects.toThrow();
  });

  it("removes a skill's role links when the skill or the role is deleted", async () => {
    const figma = await db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma" } });
    const research = await db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "User research" } });
    const role = await db.experience.create({
      data: {
        profileId: TEST_PROFILE_ID,
        role: "Product Designer",
        startYear: 2018,
        startMonth: 6,
        skills: { create: [{ skillId: figma.id }, { skillId: research.id }] },
      },
    });
    const other = await db.experience.create({
      data: { profileId: TEST_PROFILE_ID, role: "UX Designer", skills: { create: [{ skillId: figma.id }] } },
    });

    await db.skill.delete({ where: { id: figma.id } });
    expect(await db.experienceSkill.findMany({ orderBy: { skillId: "asc" } })).toEqual([
      { experienceId: role.id, skillId: research.id },
    ]);

    await db.experience.delete({ where: { id: role.id } });
    expect(await db.experienceSkill.count()).toBe(0);
    expect(await db.skill.count()).toBe(1);
    expect(await db.experience.findUnique({ where: { id: other.id } })).not.toBeNull();
  });
});
