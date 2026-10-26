import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadFacts, loadFactTexts, loadProfile } from "@/lib/profile-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { createFact, removeFact, restoreFact, saveFact } from "./fact-actions";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", company: "Ledgerly" } });
});
afterAll(() => prisma().$disconnect());

/** Adds a fact and types `text` into it. */
async function fact(applicationId: string | null, text: string) {
  const created = await createFact({ applicationId });
  if (!created.ok) throw new Error(created.error);
  await saveFact({ id: created.data.id, text });
  return created.data.id;
}

describe("facts (PRO-14, APP-15)", () => {
  it("adds blank facts to the profile or an application, kept apart, in the order they were added", async () => {
    expect(await createFact({ applicationId: null })).toEqual({ ok: true, data: { id: expect.any(String), text: "" } });
    await fact(null, "I can start at short notice.");
    await fact("app-1", "I know their product as a customer.");
    await fact(null, "I'd like to stay close to research.");

    expect((await loadProfile()).facts.map((entry) => entry.text)).toEqual(["", "I can start at short notice.", "I'd like to stay close to research."]);
    expect(await loadFacts("app-1")).toEqual([{ id: expect.any(String), text: "I know their product as a customer." }]);
    // What the AI gets: no blank ones, trimmed.
    await fact("app-1", "  Lean on my research work.  ");
    await fact("app-1", "   ");
    expect(await loadFactTexts("app-1")).toEqual(["I know their product as a customer.", "Lean on my research work."]);
  });

  it("puts a removed fact back in its place", async () => {
    const first = await fact(null, "First");
    await fact(null, "Second");
    const removed = await removeFact({ id: first });
    expect(removed).toEqual({ ok: true, data: { sort: expect.any(Number) } });
    expect((await loadProfile()).facts.map((entry) => entry.text)).toEqual(["Second"]);

    const sort = removed.ok ? removed.data.sort : null;
    expect(await restoreFact({ id: first, applicationId: null, text: "First", sort })).toEqual({ ok: true, data: { id: first, text: "First" } });
    expect((await loadProfile()).facts.map((entry) => entry.text)).toEqual(["First", "Second"]);
    // Twice is still once.
    await restoreFact({ id: first, applicationId: null, text: "First", sort });
    expect(await prisma().fact.count()).toBe(2);
  });

  it("goes with its application", async () => {
    await fact("app-1", "Met their design lead.");
    await prisma().application.delete({ where: { id: "app-1" } });
    expect(await prisma().fact.count()).toBe(0);
  });

  it("refuses an application that's gone, a fact that's too long, and more than 50", async () => {
    expect(await createFact({ applicationId: "gone" })).toEqual({ ok: false, error: "This application doesn't exist any more." });
    const id = await fact(null, "");
    expect(await saveFact({ id, text: "x".repeat(1001) })).toMatchObject({ ok: false });

    await prisma().fact.createMany({ data: Array.from({ length: 49 }, (_, sort) => ({ text: `Fact ${sort}`, sort })) });
    expect(await createFact({ applicationId: null })).toEqual({ ok: false, error: "That's 50 facts already. Remove one you no longer need first." });
    // An application has room of its own.
    expect(await createFact({ applicationId: "app-1" })).toMatchObject({ ok: true });
  });
});
