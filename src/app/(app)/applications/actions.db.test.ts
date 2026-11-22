import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { rememberListView, reorderBoard } from "./actions";

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

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("rememberListView (E9-4)", () => {
  it("starts from the board, latest update first", async () => {
    expect(await loadSettings()).toMatchObject({ applicationsView: "board", applicationsSort: "updated", applicationsBoardStatuses: [] });
  });

  it("saves the view and sort in Settings", async () => {
    expect(await rememberListView({ view: "list", sort: { key: "match", reversed: true } })).toEqual({ ok: true, data: null });
    expect(await loadSettings()).toMatchObject({ applicationsView: "list", applicationsSort: "-match" });
  });

  it("keeps Board per status, and leaves the view for all applications alone (E29-1, LB1)", async () => {
    await rememberListView({ view: "board", status: "sent", sort: { key: "updated", reversed: false } });
    await rememberListView({ view: "board", status: "closed", sort: { key: "updated", reversed: false } });
    expect(await loadSettings()).toMatchObject({ applicationsView: "board", applicationsBoardStatuses: ["sent", "closed"] });
    await rememberListView({ view: "list", status: "sent", sort: { key: "updated", reversed: false } });
    expect((await loadSettings()).applicationsBoardStatuses).toEqual(["closed"]);
  });

  it("reads the list's old name in Settings", async () => {
    await prisma().setting.create({ data: { key: "applicationsView", value: "table" } });
    expect((await loadSettings()).applicationsView).toBe("list");
  });

  it("refuses what the list doesn't know", async () => {
    expect(await rememberListView({ view: "grid" as "board", sort: { key: "updated", reversed: false } })).toMatchObject({ ok: false });
  });
});

describe("reorderBoard (public issue 60)", () => {
  const places = async () => {
    const rows = await prisma().application.findMany({ orderBy: { id: "asc" }, select: { id: true, boardSort: true } });
    return Object.fromEntries(rows.map((row) => [row.id, row.boardSort]));
  };

  // Newest first: a, b, c.
  beforeEach(() =>
    prisma().application.createMany({
      data: ["a", "b", "c"].map((id, index) => ({ id, status: "SENT" as const, updatedAt: new Date(Date.UTC(2026, 8, 27, 12, 30 - index)) })),
    }),
  );

  it("gives the column its new places and leaves other columns alone", async () => {
    await prisma().application.create({ data: { id: "draft", status: "DRAFT" } });
    expect(await reorderBoard({ status: "SENT", ids: ["c", "a", "b"] })).toEqual({ ok: true, data: null });
    expect(await places()).toEqual({ c: 0, a: 1, b: 2, draft: null });
  });

  it("keeps each card's Updated, since reordering isn't news", async () => {
    const updated = () => prisma().application.findMany({ orderBy: { id: "asc" }, select: { id: true, updatedAt: true } });
    const before = await updated();
    await reorderBoard({ status: "SENT", ids: ["c", "b", "a"] });
    expect(await updated()).toEqual(before);
  });

  it("leaves a card that a search hides in its place", async () => {
    await reorderBoard({ status: "SENT", ids: ["c", "a"] });
    expect(await places()).toEqual({ c: 0, b: 1, a: 2 });
  });

  it("leaves alone a card that has moved to another column since", async () => {
    await prisma().application.update({ where: { id: "c" }, data: { status: "SCREENING" } });
    await reorderBoard({ status: "SENT", ids: ["c", "b", "a"] });
    expect(await places()).toEqual({ b: 0, a: 1, c: null });
  });

  it("refuses an empty order", async () => {
    expect(await reorderBoard({ status: "SENT", ids: [] })).toMatchObject({ ok: false });
  });
});
