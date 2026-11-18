import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { deleteProfileAction, newProfile, renameProfileAction } from "./profiles-actions";

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
const openId = async () => (await prisma().setting.findUnique({ where: { key: "openProfileId" } }))?.value;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("profile actions (E24-2)", () => {
  it("makes an empty profile, or a copy, last in the list, and opens it", async () => {
    await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Figma" } });
    const empty = await newProfile({ start: "empty", name: " Backend ", levels: { from: "lead", to: "senior" } });
    if (!empty.ok) throw new Error(empty.error);
    // Its levels, put in order (E24-3).
    expect(await prisma().profile.findUniqueOrThrow({ where: { id: empty.data.id } })).toMatchObject({ name: "Backend", sort: 1, levelFrom: "senior", levelTo: "lead" });
    expect(await prisma().skill.count({ where: { profileId: empty.data.id } })).toBe(0);
    expect(await openId()).toBe(empty.data.id);

    const copy = await newProfile({ start: "copy", name: "Frontend", from: TEST_PROFILE_ID });
    if (!copy.ok) throw new Error(copy.error);
    expect(await prisma().skill.count({ where: { profileId: copy.data.id } })).toBe(1);
    expect(copy).toMatchObject({ toast: "Made “Frontend”." });
    expect(await newProfile({ start: "copy", name: "Gone", from: "gone" })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    expect(await newProfile({ start: "empty", name: "  ", levels: { from: "mid", to: "mid" } })).toMatchObject({ ok: false, fieldErrors: { name: ["Give the profile a name."] } });
  });

  it("renames a profile, and deletes one with a confirmation, but never the last", async () => {
    expect(await renameProfileAction({ id: TEST_PROFILE_ID, name: "Designer" })).toEqual({ ok: true, data: null });
    expect((await prisma().profile.findUniqueOrThrow({ where: { id: TEST_PROFILE_ID } })).name).toBe("Designer");
    expect(await deleteProfileAction({ id: TEST_PROFILE_ID })).toMatchObject({ ok: false, error: expect.stringMatching(/only profile/) });

    const other = await newProfile({ start: "empty", name: "Backend", levels: { from: "mid", to: "senior" } });
    if (!other.ok) throw new Error(other.error);
    expect(await deleteProfileAction({ id: other.data.id })).toMatchObject({ ok: true, data: { id: TEST_PROFILE_ID }, toast: "Deleted “Backend”." });
    expect(await openId()).toBe(TEST_PROFILE_ID);
  });
});
