import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProfileSettings } from "@/lib/profiles";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";

import { themeFile } from "@/lib/theme-file";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { deleteTheme, duplicateTheme, importTheme, saveResumeSections, saveTheme, setBaseTheme } from "./actions";

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

const prisma = () => db.client!;
const baseThemeId = async () => (await loadProfileSettings()).baseThemeId;

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
});
afterAll(() => prisma().$disconnect());

/** One of the test profile's own settings as stored (E24-1), or undefined when it's not set. */
const storedProfileSetting = async (key: string) =>
  ((await prisma().profile.findUniqueOrThrow({ where: { id: TEST_PROFILE_ID } })).settings as Record<string, string>)[key];

describe("setBaseTheme", () => {
  it("makes a theme the base resume theme", async () => {
    expect(await setBaseTheme({ profileId: TEST_PROFILE_ID, id: "modern" })).toEqual({ ok: true, data: null });
    expect(await baseThemeId()).toBe("modern");
  });

  it("refuses a theme that doesn't exist", async () => {
    expect(await setBaseTheme({ profileId: TEST_PROFILE_ID, id: "gone" })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't exist/) });
    expect(await baseThemeId()).toBe("editorial");
  });
});

describe("saveTheme", () => {
  const draft = {
    id: null,
    name: "  Green mono ",
    headFont: "PLEX_MONO",
    bodyFont: "GEIST",
    accent: "#2D6A4F",
    layout: "SPLIT",
    align: "LEFT",
    headingStyle: "RULE",
    density: "COMPACT",
    headerStyle: "BANNER",
    sidebarStyle: "TINTED",
    dateStyle: "TIMELINE",
    photoShape: "PORTRAIT",
    photoPosition: "SIDEBAR",
  } as const;

  it("saves a new theme and makes it the base theme (RES-4)", async () => {
    const result = await saveTheme({ ...draft, profileId: TEST_PROFILE_ID });
    expect(result).toMatchObject({
      ok: true,
      data: { name: "Green mono", accent: "#2d6a4f", builtIn: false, headerStyle: "BANNER", sidebarStyle: "TINTED", dateStyle: "TIMELINE", photoShape: "PORTRAIT", photoPosition: "SIDEBAR" },
      toast: "Saved “Green mono”. It's now your base resume theme.",
    });
    const id = result.ok ? result.data.id : "";
    expect(await baseThemeId()).toBe(id);
    expect(await prisma().theme.count({ where: { builtIn: false } })).toBe(1);
  });

  it("edits a custom theme in place", async () => {
    const created = await saveTheme({ ...draft, profileId: TEST_PROFILE_ID });
    const id = created.ok ? created.data.id : "";
    await setBaseTheme({ profileId: TEST_PROFILE_ID, id: "classic" });
    const result = await saveTheme({ profileId: TEST_PROFILE_ID, ...draft, id, name: "Renamed", density: "AIRY" });
    expect(result).toMatchObject({ ok: true, data: { id, name: "Renamed", density: "AIRY" } });
    expect(await prisma().theme.count({ where: { builtIn: false } })).toBe(1);
    expect(await baseThemeId()).toBe(id);
  });

  it("names an unnamed theme “My theme”", async () => {
    expect(await saveTheme({ profileId: TEST_PROFILE_ID, ...draft, name: "   " })).toMatchObject({ ok: true, data: { name: "My theme" } });
  });

  it("never changes a built-in theme", async () => {
    expect(await saveTheme({ profileId: TEST_PROFILE_ID, ...draft, id: "editorial" })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Built-in themes can't be changed/),
    });
    expect(await prisma().theme.findUniqueOrThrow({ where: { id: "editorial" } })).toMatchObject({ name: "Editorial" });
  });

  it("refuses a theme that no longer exists, and colours that aren't hex", async () => {
    expect(await saveTheme({ profileId: TEST_PROFILE_ID, ...draft, id: "gone" })).toMatchObject({ ok: false, error: expect.stringMatching(/doesn't exist/) });
    expect(await saveTheme({ profileId: TEST_PROFILE_ID, ...draft, accent: "red" })).toMatchObject({ ok: false, fieldErrors: { accent: expect.any(Array) } });
    expect(await prisma().theme.count({ where: { builtIn: false } })).toBe(0);
  });
});

describe("managing themes (E5-7)", () => {
  it("duplicates a built-in theme into a custom one, which becomes the base theme", async () => {
    const result = await duplicateTheme({ profileId: TEST_PROFILE_ID, id: "modern" });
    expect(result).toMatchObject({ ok: true, data: { name: "Modern copy", builtIn: false }, toast: "Made “Modern copy”. It's now your base resume theme." });
    if (!result.ok) return;
    const modern = BUILT_IN_THEMES.find((theme) => theme.id === "modern")!;
    expect(result.data).toMatchObject({ headFont: modern.headFont, accent: modern.accent, layout: modern.layout });
    expect(await baseThemeId()).toBe(result.data.id);
  });

  it("deletes a custom theme: its documents lose the link, and the base falls back to Editorial", async () => {
    const copy = await duplicateTheme({ profileId: TEST_PROFILE_ID, id: "modern" });
    if (!copy.ok) throw new Error(copy.error);
    const application = await prisma().application.create({ data: { title: "Designer · Acme", company: "Acme" } });
    await prisma().document.create({ data: { applicationId: application.id, kind: "RESUME", units: [], themeId: copy.data.id } });

    expect(await deleteTheme({ profileId: TEST_PROFILE_ID, id: copy.data.id })).toEqual({ ok: true, data: { baseThemeId: "editorial" }, toast: "Deleted “Modern copy”." });
    expect(await prisma().theme.findUnique({ where: { id: copy.data.id } })).toBeNull();
    expect((await prisma().document.findFirstOrThrow()).themeId).toBeNull();
    expect(await baseThemeId()).toBe("editorial");
  });

  it("keeps the base theme when another theme is deleted, and never deletes a built-in", async () => {
    const copy = await duplicateTheme({ profileId: TEST_PROFILE_ID, id: "modern" });
    if (!copy.ok) throw new Error(copy.error);
    await setBaseTheme({ profileId: TEST_PROFILE_ID, id: "technical" });
    expect(await deleteTheme({ profileId: TEST_PROFILE_ID, id: copy.data.id })).toMatchObject({ ok: true, data: { baseThemeId: "technical" } });
    expect(await deleteTheme({ profileId: TEST_PROFILE_ID, id: "editorial" })).toEqual({ ok: false, error: "Built-in themes can't be deleted." });
  });

  it("imports a theme file, checked again on the server", async () => {
    const file = themeFile({ ...BUILT_IN_THEMES[0], name: "Shared theme", accent: "#1F6F5C" });
    const result = await importTheme({ profileId: TEST_PROFILE_ID, file });
    expect(result).toMatchObject({ ok: true, data: { name: "Shared theme", accent: "#1f6f5c", builtIn: false } });
    if (result.ok) expect(await baseThemeId()).toBe(result.data.id);

    const bad = await importTheme({ profileId: TEST_PROFILE_ID, file: { ...file, theme: { ...file.theme, bodyFont: "PAPYRUS" } } });
    expect(bad).toEqual({ ok: false, error: "That theme uses a font Dossier doesn't have (PAPYRUS)." });
    expect(await prisma().theme.count({ where: { builtIn: false } })).toBe(1);
  });
});


describe("the base resume's sections (#297)", () => {
  it("saves the base resume's order", async () => {
    await saveResumeSections({ profileId: TEST_PROFILE_ID, order: ["skills", "summary"], off: ["projects"] });
    expect(await storedProfileSetting("resumeSections")).toBe(JSON.stringify({ order: ["skills", "summary"], off: ["projects"] }));
  });
});
