import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";
import { seedDemo } from "../../../../prisma/seed/demo";

import { deleteEverything } from "./actions";

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
const redirected = vi.hoisted(() => ({ to: "" }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    redirected.to = to;
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
  unstable_rethrow: (error: unknown) => {
    if ((error as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw error;
  },
}));
const dataDir = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({ env: { get DOSSIER_DATA_DIR() { return dataDir.path; }, DOSSIER_SECRET: "s".repeat(32) } }));

const prisma = () => db.client!;
const now = new Date(2026, 8, 28, 12);
const snapshot = async () => JSON.stringify({ ...(await buildExport(prisma(), { now })), exportedAt: null });

beforeEach(async () => {
  dataDir.path = await mkdtemp(path.join(tmpdir(), "dossier-delete-"));
  await mkdir(path.join(dataDir.path, "backups"));
  await writeFile(path.join(dataDir.path, "backups", "dossier-backup-nightly-2026-09-27-030000.json"), "{}");
  redirected.to = "";
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
  await prisma().theme.create({ data: { id: "mine", name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#224466" } });
  await prisma().setting.create({ data: { key: "paper", value: "LETTER" } });
  await prisma().job.create({ data: { type: "refine", key: "refine:x", status: "DONE", input: {} } });
});
afterAll(async () => {
  await rm(dataDir.path, { recursive: true, force: true });
  await prisma().$disconnect();
});

describe("deleteEverything (E10-8)", () => {
  it("wipes all user data and the backups, keeps the built-in themes, and lands on the dashboard", async () => {
    // A saved posting from Find jobs goes too (E14-9).
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", savedAt: new Date() } });
    await prisma().postingSearch.create({ data: { source: "JSEARCH", query: {}, postings: [] } });
    // And what the job agent found (E16).
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "job-1", dedupeKey: "key-1" } });
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "job-1", score: 80, reasons: [], redFlags: [], scoredWith: "score-posting@1" } });
    await expect(deleteEverything({ confirm: "DELETE" })).rejects.toThrow("NEXT_REDIRECT");
    expect(redirected.to).toBe("/");
    const counts = await Promise.all([
      prisma().posting.count(),
      prisma().postingSearch.count(),
      prisma().agentCandidate.count(),
      prisma().postingScore.count(),
      prisma().application.count(),
      prisma().document.count(),
      prisma().skill.count(),
      prisma().experience.count(),
      prisma().project.count(),
      prisma().profileField.count(),
      prisma().setting.count(),
      prisma().job.count(),
      prisma().theme.count({ where: { builtIn: false } }),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await prisma().theme.count({ where: { builtIn: true } })).toBe(12);
    expect(await readdir(dataDir.path)).toEqual([]);
  });

  it("does nothing without DELETE typed exactly", async () => {
    expect(await deleteEverything({ confirm: "delete" as "DELETE" })).toMatchObject({ ok: false });
    expect(await prisma().application.count()).toBeGreaterThan(0);
  });

  it("comes back whole from an export (the epic's round trip)", async () => {
    const before = await snapshot();
    const file = parseExport(JSON.stringify(await buildExport(prisma(), { now })));
    await deleteEverything({ confirm: "DELETE" }).catch(() => {});
    expect(await prisma().application.count()).toBe(0);

    if (!file.ok) throw new Error(file.error);
    await importExport(prisma(), file.data);
    expect(await snapshot()).toBe(before);
  });
});
