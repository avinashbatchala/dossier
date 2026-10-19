import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { deleteApplication, setArchived } from "./application-actions";

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
const updatedAt = new Date("2026-09-20T10:00:00Z");

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      company: "Ledgerly",
      updatedAt,
      documents: { create: { kind: "RESUME", units: [] } },
      messages: { create: { role: "AI", text: "Hi" } },
      notes: { create: { body: "Private" } },
      events: { create: { from: "DRAFT", to: "SENT" } },
    },
  });
  await prisma().job.createMany({
    data: [
      { id: "claimed", type: "write-documents", key: "application:app-1", applicationId: "app-1", status: "DONE", input: { posting: "…" } },
      { id: "refine", type: "refine", key: "refine:app-1", applicationId: "app-1", status: "DONE", input: {} },
      { id: "email", type: "write-email", key: "email:app-1", applicationId: "app-1", status: "DONE", input: {}, result: { units: [], previous: [] } },
      { id: "other", type: "import-profile", key: "profile-import", status: "DONE", input: { resume: "…" } },
    ],
  });
});
afterAll(() => prisma().$disconnect());

describe("setArchived (E9-5)", () => {
  it("archives and brings back, keeping when it was last updated", async () => {
    expect(await setArchived({ id: "app-1", archived: true })).toEqual({ ok: true, data: null });
    const archived = await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.updatedAt).toEqual(updatedAt);

    await setArchived({ id: "app-1", archived: false });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).toMatchObject({ archivedAt: null, updatedAt });
  });

  it("says so when the application is gone", async () => {
    expect(await setArchived({ id: "gone", archived: true })).toEqual({ ok: false, error: "That application no longer exists." });
  });
});

describe("deleteApplication (E9-5)", () => {
  it("deletes it with its documents and their versions, chat, notes, history and jobs, its emails' included", async () => {
    const resume = await prisma().document.findFirstOrThrow({ where: { applicationId: "app-1" } });
    await prisma().documentVersion.create({ data: { documentId: resume.id, units: [], cause: "WRITTEN" } });
    expect(await deleteApplication({ id: "app-1" })).toEqual({ ok: true, data: null });
    const counts = await Promise.all([
      prisma().application.count(),
      prisma().document.count(),
      prisma().documentVersion.count(),
      prisma().chatMessage.count(),
      prisma().note.count(),
      prisma().statusEvent.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await prisma().job.findMany({ select: { id: true } })).toEqual([{ id: "other" }]);
  });


  it("says so when it's already gone", async () => {
    await deleteApplication({ id: "app-1" });
    expect(await deleteApplication({ id: "app-1" })).toEqual({ ok: false, error: "That application no longer exists." });
  });
});
