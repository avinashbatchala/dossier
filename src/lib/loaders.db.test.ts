import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { loadDocuments } from "./application-documents";
import { loadApplicationRows } from "./applications-data";
import { DEFAULT_SORT } from "./applications-list";
import { loadProfile } from "./profile-data";
import { loadTheme, loadThemes } from "./theme-data";
import { BUILT_IN_THEMES } from "./themes";

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
// React's per-request cache would keep the first answer across tests.
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T,>(fn: T) => fn }));

const prisma = () => db.client!;
const now = new Date(2026, 8, 28, 12);

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
});
afterAll(() => prisma().$disconnect());

describe("loadApplicationRows (E9-1)", () => {
  it("lists applications as the board and table show them, archived ones only when asked", async () => {
    await prisma().application.updateMany({ where: { company: "Quill & Co" }, data: { archivedAt: now } });
    const rows = await loadApplicationRows({ archived: false, sort: DEFAULT_SORT }, { now, quietDays: 7, timeZone: "Europe/Berlin" });
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => row.company === "Quill & Co")).toBe(false);
    expect(rows.find((row) => row.company === "Oaken Studio")).toMatchObject({ status: "OFFER", sent: expect.stringMatching(/^\d+ \w{3}$/), match: { hit: expect.any(Number), total: expect.any(Number) } });
    expect(rows.find((row) => row.company === "Brightline Transit")).toMatchObject({ status: "DRAFT", sent: null, deadline: expect.stringMatching(/2026$/) });
    expect(rows.map((row) => row.updatedAt)).toEqual([...rows.map((row) => row.updatedAt)].sort((a, b) => b - a));

    const all = await loadApplicationRows({ archived: true, sort: DEFAULT_SORT }, { now, quietDays: 7, timeZone: "Europe/Berlin" });
    expect(all.find((row) => row.company === "Quill & Co")).toMatchObject({ archived: true });
  });
});

describe("loadDocuments (E8-8)", () => {
  it("loads an application's documents with their themes and what the page needs", async () => {
    const ledgerly = await prisma().application.findFirstOrThrow({ where: { documents: { some: {} } } });
    const trimmed = [{ kind: "unit", unit: demoResumeUnits()[1], index: 1 }];
    await prisma().document.updateMany({ where: { applicationId: ledgerly.id, kind: "RESUME" }, data: { themeId: "modern", trimmed } });
    await prisma().document.updateMany({ where: { applicationId: ledgerly.id, kind: "COVER_LETTER" }, data: { themeId: null } });

    const loaded = await loadDocuments(ledgerly.id);
    expect(loaded.resume).toMatchObject({ theme: { id: "modern" }, trimmed });
    // No theme of its own: the base theme.
    expect(loaded.letter?.theme.id).toBe("editorial");
    expect(loaded.includeReferences).toBe(false);
    expect(loaded.letterDate.getUTCHours()).toBe(0);
  });

  it("shows the not-found page for an unknown application", async () => {
    await expect(loadDocuments("gone")).rejects.toThrow("not found");
  });
});

describe("theme and profile loaders", () => {
  it("lists the built-in themes in the picker's order, then the user's own", async () => {
    await prisma().theme.create({ data: { id: "mine", name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#224466" } });
    const themes = await loadThemes();
    expect(themes.map((theme) => theme.id)).toEqual([...BUILT_IN_THEMES.map((theme) => theme.id), "mine"]);
    expect(await loadTheme("gone")).toBeNull();
  });

  it("loads the profile with the newest roles first", async () => {
    const profile = await loadProfile();
    expect(profile.experience.map((entry) => entry.company)).toEqual(["Northwind Logistics", "Fieldnote", "Studio Brik"]);
    expect(profile.experience[0].skillIds.length).toBeGreaterThan(0);
  });
});
