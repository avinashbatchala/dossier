import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { writeBackup } from "@/lib/backups";
import { importExport, parseExport } from "@/lib/data-import";

import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { job: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/jobs/runner", () => ({ cancelJob: vi.fn() }));
vi.mock("@/lib/backups", () => ({ writeBackup: vi.fn(async () => "dossier-backup-before-import-2026-09-28-120000.json") }));
const summary = { applications: 2, roles: 3, skills: 7, themes: 0, notes: 1 };
vi.mock("@/lib/frozen-copy", () => ({ freezeSentApplications: vi.fn() }));
vi.mock("@/lib/data-import", () => ({
  parseExport: vi.fn(() => ({ ok: true, data: { exportedAt: new Date("2026-09-27T10:00:00Z") } })),
  summarizeExport: vi.fn(() => summary),
  currentSummary: vi.fn(async () => ({ ...summary, applications: 9 })),
  importExport: vi.fn(),
}));

const post = (query = "", headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`http://localhost:3000/api/import${query}`, {
      method: "POST",
      body: "{}",
      headers: { origin: "http://localhost:3000", host: "localhost:3000", ...headers },
    }),
    undefined,
  );

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(importExport).mockClear();
  vi.mocked(writeBackup).mockClear();
});

describe("POST /api/import (E10-6)", () => {
  it("says what a file would replace, changing nothing", async () => {
    const response = await post("?preview=1");
    expect(await response.json()).toEqual({ incoming: summary, current: { ...summary, applications: 9 }, exportedAt: "2026-09-27T10:00:00.000Z" });
    expect(importExport).not.toHaveBeenCalled();
    expect(writeBackup).not.toHaveBeenCalled();
  });

  it("backs up first, then imports", async () => {
    const order: string[] = [];
    vi.mocked(writeBackup).mockImplementationOnce(async () => (order.push("backup"), "backup.json"));
    vi.mocked(importExport).mockImplementationOnce(async () => void order.push("import"));
    const response = await post();
    expect(await response.json()).toEqual({ incoming: summary, backup: "backup.json" });
    expect(order).toEqual(["backup", "import"]);
  });

  it("refuses a file that isn't an export", async () => {
    vi.mocked(parseExport).mockReturnValueOnce({ ok: false, error: "That file isn't a Dossier export." });
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "That file isn't a Dossier export." });
    expect(writeBackup).not.toHaveBeenCalled();
  });

  it("refuses a file over the size limit before reading it", async () => {
    vi.mocked(parseExport).mockClear();
    const response = await post("", { "content-length": String(11 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(parseExport).not.toHaveBeenCalled();
  });

  it("refuses other sites and signed-out visitors", async () => {
    expect((await post("", { origin: "https://evil.example" })).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await post()).status).toBe(401);
  });
});
