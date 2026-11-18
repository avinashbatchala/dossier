import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProfileSettings, saveProfileSettings } from "@/lib/profiles";

import { Prisma } from "@/generated/prisma/client";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { loadSettings, saveSettings } from "./settings-data";

// The settings helpers run against the test database.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;

const editorial: Prisma.ThemeCreateInput = {
  id: "editorial",
  builtIn: true,
  name: "Editorial",
  headFont: "NEWSREADER",
  bodyFont: "GEIST",
  accent: "#7a3b2e",
};

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().theme.create({ data: editorial });
});
afterAll(() => prisma().$disconnect());

describe("settings and themes", () => {
  it("saves settings as text rows and reads them back", async () => {
    await saveSettings({ provider: "LOCAL", strict: false, customLanguages: ["Farsi"], docLanguage: "Dutch" });
    expect(await prisma().setting.findMany({ select: { key: true, value: true }, orderBy: { key: "asc" } })).toEqual([
      { key: "customLanguages", value: '["Farsi"]' },
      { key: "docLanguage", value: "Dutch" },
      { key: "provider", value: "LOCAL" },
      { key: "strict", value: "false" },
    ]);
    expect(await loadSettings()).toMatchObject({ provider: "LOCAL", strict: false, customLanguages: ["Farsi"], docLanguage: "Dutch", paper: "A4" });
  });

  it("removes a setting saved as null, so it reads as not set", async () => {
    await saveSettings({ docLanguage: "Dutch", paper: "LETTER" });
    await saveSettings({ docLanguage: null });
    expect(await loadSettings()).toMatchObject({ docLanguage: null, paper: "LETTER" });
    expect(await prisma().setting.count()).toBe(1);
  });

  it("saves as part of a transaction it's given", async () => {
    await expect(
      prisma().$transaction(async (tx) => {
        await saveSettings({ paper: "LETTER" }, tx);
        throw new Error("Rolled back");
      }),
    ).rejects.toThrow("Rolled back");
    expect((await loadSettings()).paper).toBe("A4");
  });

  it("falls back to Editorial when the custom base theme is deleted", async () => {
    const custom = await prisma().theme.create({
      data: { name: "Mine", headFont: "GARAMOND", bodyFont: "GARAMOND", accent: "#2f5d8a" },
    });
    await saveProfileSettings(TEST_PROFILE_ID, { baseThemeId: custom.id });
    expect((await loadProfileSettings()).baseThemeId).toBe(custom.id);

    await prisma().theme.delete({ where: { id: custom.id } });
    expect((await loadProfileSettings()).baseThemeId).toBe("editorial");
  });

  it("refuses to delete a built-in theme", async () => {
    // The trigger raises restrict_violation, which Prisma reports as P2003.
    await expect(prisma().theme.delete({ where: { id: "editorial" } })).rejects.toSatisfy(
      (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003",
    );
    expect(await prisma().theme.count()).toBe(1);
  });
});
