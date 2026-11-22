import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { dismissAnnouncement } from "./actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const session = vi.hoisted(() => ({ signedIn: true }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => (session.signedIn ? { persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prisma = () => db.client!;

beforeEach(async () => {
  session.signedIn = true;
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("dismissAnnouncement (E18-3)", () => {
  it("adds to what's dismissed", async () => {
    await saveSettings({ announcementsDismissed: ["ann_1"] });
    expect(await dismissAnnouncement({ id: "ann_2" })).toEqual({ ok: true, data: null });
    expect((await loadSettings()).announcementsDismissed).toEqual(["ann_1", "ann_2"]);
  });

  it("needs a session and an ID", async () => {
    expect((await dismissAnnouncement({ id: "" })).ok).toBe(false);
    session.signedIn = false;
    expect((await dismissAnnouncement({ id: "ann_1" })).ok).toBe(false);
    expect((await loadSettings()).announcementsDismissed).toEqual([]);
  });
});
