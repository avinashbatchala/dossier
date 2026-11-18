import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings, saveSettings } from "@/lib/settings-data";
import { importExport, parseExport } from "@/lib/data-import";
import { EMPTY_QUERY } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { catchUpBackup, lastNightlyBackup, nextRun, pruneBackups, runNightlyBackup } from "./backup-schedule";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const dataDir = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({
  env: { get DOSSIER_DATA_DIR() { return dataDir.path; }, DOSSIER_BACKUP_RETENTION_DAYS: 14, DOSSIER_SECRET: "s".repeat(32) },
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

const prisma = () => db.client!;
const backups = () => readdir(path.join(dataDir.path, "backups")).catch(() => [] as string[]);

beforeEach(async () => {
  dataDir.path = await mkdtemp(path.join(tmpdir(), "dossier-backups-"));
  await resetDatabase(prisma());
  await prisma().application.create({ data: { company: "Ledgerly" } });
});
afterAll(async () => {
  await rm(dataDir.path, { recursive: true, force: true });
  await prisma().$disconnect();
});

describe("nightly backups (E10-7)", () => {
  it("run at the next 03:00", () => {
    expect(nextRun(new Date(2026, 8, 28, 1, 30))).toEqual(new Date(2026, 8, 28, 3, 0));
    expect(nextRun(new Date(2026, 8, 28, 3, 0))).toEqual(new Date(2026, 8, 29, 3, 0));
    expect(nextRun(new Date(2026, 8, 28, 22, 0))).toEqual(new Date(2026, 8, 29, 3, 0));
  });

  it("write an export while they're on", async () => {
    const search = await prisma().agentSearch.create({ data: { name: "Design", query: { ...EMPTY_QUERY, keywords: "Designer", country: "nl" }, enabled: false } });
    const candidate = await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "backup", dedupeKey: "backup", title: "Designer" } });
    await prisma().agentCandidateSearch.createMany({ data: [
      { candidateId: candidate.id, searchId: search.id, searchName: "Original name" },
      { candidateId: candidate.id, searchId: null, searchName: "Deleted search" },
    ] });
    const now = new Date(2026, 8, 28, 3, 0);
    expect(await runNightlyBackup(now)).toBe("written");
    expect(await backups()).toEqual(["dossier-backup-nightly-2026-09-28-030000.json"]);
    expect(await lastNightlyBackup()).toBeInstanceOf(Date);
    const parsed = parseExport(await readFile(path.join(dataDir.path, "backups", (await backups())[0]), "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.schemaVersion).toBe(16);
    expect(parsed.data.agentSearches).toEqual([expect.objectContaining({ id: search.id, name: "Design", enabled: false })]);
    expect(parsed.data.agentCandidateSearches).toHaveLength(2);
    await prisma().agentCandidate.deleteMany();
    await prisma().agentSearch.deleteMany();
    await importExport(prisma(), parsed.data);
    expect(await prisma().agentSearch.findUnique({ where: { id: search.id } })).toMatchObject({ name: "Design", enabled: false });
    expect(await prisma().agentCandidateSearch.findMany({ orderBy: { searchName: "asc" } })).toEqual([
      expect.objectContaining({ candidateId: candidate.id, searchId: null, searchName: "Deleted search" }),
      expect.objectContaining({ candidateId: candidate.id, searchId: search.id, searchName: "Original name" }),
    ]);
  });

  it("catch up at the start when the last one is over a day old, or there's none (#325)", async () => {
    const dir = path.join(dataDir.path, "backups");
    expect(await catchUpBackup(new Date(2026, 8, 28, 10, 0))).toBe("written");
    expect(await backups()).toEqual(["dossier-backup-nightly-2026-09-28-100000.json"]);

    // Two days later, with the computer off at 03:00: another one.
    const first = new Date(2026, 8, 28, 10, 0);
    await utimes(path.join(dir, "dossier-backup-nightly-2026-09-28-100000.json"), first, first);
    expect(await catchUpBackup(new Date(2026, 8, 30, 10, 0))).toBe("written");
    expect(await backups()).toHaveLength(2);

    // Started again an hour later: the last one is recent, so nothing more.
    const second = new Date(2026, 8, 30, 10, 0);
    await utimes(path.join(dir, "dossier-backup-nightly-2026-09-30-100000.json"), second, second);
    expect(await catchUpBackup(new Date(2026, 8, 30, 11, 0))).toBe("recent");
    expect(await backups()).toHaveLength(2);
  });

  it("don't catch up while they're off", async () => {
    await saveSettings({ nightlyBackup: false });
    expect(await catchUpBackup()).toBe("off");
    expect(await backups()).toEqual([]);
  });

  it("write nothing while they're off", async () => {
    await saveSettings({ nightlyBackup: false });
    expect(await runNightlyBackup()).toBe("off");
    expect(await backups()).toEqual([]);
  });

  it("remove backups past the retention", async () => {
    const dir = path.join(dataDir.path, "backups");
    await runNightlyBackup(new Date(2026, 8, 28, 3));
    const old = path.join(dir, "dossier-backup-nightly-2026-09-01-030000.json");
    await writeFile(old, "{}");
    const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(old, monthAgo, monthAgo);
    expect(await pruneBackups(new Date())).toBe(1);
    expect(await backups()).toEqual(["dossier-backup-nightly-2026-09-28-030000.json"]);
  });

  it("keep a failure for the settings row, and clear it after a success", async () => {
    // A file where the folder should be: the backup can't be written.
    await writeFile(path.join(dataDir.path, "backups"), "not a folder");
    await expect(runNightlyBackup()).rejects.toThrow();
    expect((await loadSettings()).backupProblem).toMatch(/EEXIST|ENOTDIR/);

    await rm(path.join(dataDir.path, "backups"));
    await runNightlyBackup();
    expect((await loadSettings()).backupProblem).toBeNull();
  });
});
