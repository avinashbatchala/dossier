import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { aiRunsLocally, currentAiTest, loadSettingsStatus, runFailed } from "./settings-status-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32), DOSSIER_BACKUP_RETENTION_DAYS: 14, DATABASE_URL: process.env.DATABASE_URL, DOSSIER_DATA_DIR: "/tmp/dossier-status-test" } }));
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const now = new Date("2026-11-17T10:00:00Z");

describe("the parts of the status (E34-1)", () => {
  it("counts an OpenAI-compatible server on this computer or its network as local (ST3)", () => {
    expect(aiRunsLocally("LOCAL", "https://example.com")).toBe(true);
    expect(aiRunsLocally("LMSTUDIO", "http://host.docker.internal:1234")).toBe(true);
    expect(aiRunsLocally("OPENAI", "http://192.168.1.20:8080/v1")).toBe(true);
    expect(aiRunsLocally("OPENAI", "http://llm.local/v1")).toBe(true);
    expect(aiRunsLocally("OPENAI", "https://api.openai.com/v1")).toBe(false);
    expect(aiRunsLocally("ANTHROPIC", "http://localhost:8080")).toBe(false);
  });

  it("uses a saved test only for what's chosen now", () => {
    const test = { at: now.toISOString(), provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5", ok: true, seconds: 1.4, error: null };
    expect(currentAiTest(test, { provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5-5" })).toEqual({ at: now, ok: true, seconds: 1.4, error: null });
    expect(currentAiTest(test, { provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" })).toBeNull();
    expect(currentAiTest(null, { provider: "LOCAL", baseUrl: "", model: "" })).toBeNull();
  });

  it("calls a run failed when it was interrupted or every search failed", () => {
    const run = { at: now.toISOString(), manual: false };
    expect(runFailed({ ...run, message: "The agent scan was interrupted. Try again." })).toBe(true);
    expect(runFailed({ ...run, message: "Searched 2.", searches: [{ searchId: "a", searchName: "A", found: 0, fresh: 0, error: "No key." }] })).toBe(true);
    expect(runFailed({ ...run, message: "Searched 2.", searches: [{ searchId: "a", searchName: "A", found: 3, fresh: 1, error: null }, { searchId: "b", searchName: "B", found: 0, fresh: 0, error: "No key." }] })).toBe(false);
    expect(runFailed({ ...run, message: null })).toBe(false);
  });
});

describe("loadSettingsStatus (E34-1)", () => {
  it("reads every section from what's stored", async () => {
    const status = await loadSettingsStatus(now);
    expect(Object.keys(status)).toEqual(["ai", "documents", "scoring", "jobs", "agent", "google", "notifications", "connector", "data", "about"]);
    expect(status.documents.state).toBe("A4 · The posting's language · warm tone");
    expect(status.jobs.tone).toBe("off");
    expect(status.agent.tone).toBe("off");
    expect(status.notifications.tone).toBe("off");
  });

  it("finds a portal that failed in its last two searches", async () => {
    await saveSettings({ portals: { FREEHIRE: { on: true, fields: {}, acceptedAt: null } } });
    for (const [days, status] of [[3, "done"], [2, "failed"], [1, "failed"]] as const) {
      await prisma().postingSearch.create({
        data: { query: { keywords: "designer" }, createdAt: new Date(now.getTime() - days * 86_400_000), portals: [{ id: "FREEHIRE", status, found: 0, next: null, message: status === "failed" ? "FreeHire didn't answer." : null }] },
      });
    }
    const { jobs } = await loadSettingsStatus(now);
    expect(jobs).toMatchObject({ tone: "look", note: "FreeHire stopped working", problem: { summary: "FreeHire has failed since 15 Nov", fix: "Fix FreeHire" } });
  });
});
