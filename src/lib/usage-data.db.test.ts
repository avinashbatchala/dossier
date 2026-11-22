import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { loadUsage, recordUsage } from "./usage-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

beforeEach(async () => {
  await resetDatabase(prisma());
});
afterAll(async () => {
  await prisma().$disconnect();
});

describe("recordUsage (#290)", () => {
  it("keeps the task, provider, model and counts, null where the server didn't say", async () => {
    await recordUsage({ task: "extract-posting", provider: "ANTHROPIC", model: "claude-sonnet-5", input: 1_200, output: 300 });
    await recordUsage({ task: "score-posting-jev", provider: "JEV", model: "jev-1.14.0", input: 4_000, output: null });
    expect(await prisma().aiUsage.findMany({ orderBy: { createdAt: "asc" }, omit: { id: true, createdAt: true } })).toEqual([
      { task: "extract-posting", provider: "ANTHROPIC", model: "claude-sonnet-5", inputTokens: 1_200, outputTokens: 300 },
      { task: "score-posting-jev", provider: "JEV", model: "jev-1.14.0", inputTokens: 4_000, outputTokens: null },
    ]);
  });

  it("never fails the request when the count can't be kept", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.spyOn(prisma().aiUsage, "create").mockRejectedValueOnce(new Error("connection lost"));
    await expect(recordUsage({ task: "write-email", provider: "LOCAL", model: "qwen", input: 1, output: 1 })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[Usage] Error: connection lost"));
    create.mockRestore();
    error.mockRestore();
  });
});

describe("loadUsage", () => {
  beforeEach(async () => {
    await prisma().aiUsage.createMany({
      data: [
        { task: "tailor-resume", provider: "OPENAI", model: "gpt", inputTokens: 5_000, outputTokens: 1_500, createdAt: daysAgo(2) },
        { task: "tailor-resume", provider: "OPENAI", model: "gpt", inputTokens: 4_000, outputTokens: 1_000, createdAt: daysAgo(10) },
        { task: "tailor-resume", provider: "LOCAL", model: "llama", inputTokens: null, outputTokens: null, createdAt: daysAgo(20) },
        { task: "classify-reply", provider: "OPENAI", model: "gpt", inputTokens: 700, outputTokens: 20, createdAt: daysAgo(60) },
      ],
    });
  });

  it("adds up each task's requests in the period, counting the ones without counts apart", async () => {
    const { figures, countingSince } = await loadUsage("30d", now);
    expect(figures.rows[0]).toMatchObject({
      task: "tailor-resume",
      requests: 3,
      input: { tokens: 9_000, unreported: 1 },
      output: { tokens: 2_500, unreported: 1 },
      total: 11_500,
    });
    expect(figures.rows.find((row) => row.task === "classify-reply")).toMatchObject({ requests: 0 });
    expect(figures.total).toMatchObject({ requests: 3, total: 11_500 });
    // Whatever the period: counting started with the first request ever.
    expect(countingSince).toEqual(daysAgo(60));
  });

  it("covers every request for all time", async () => {
    const { figures } = await loadUsage("all", now);
    expect(figures.total).toMatchObject({ requests: 4, input: { tokens: 9_700, unreported: 1 }, total: 12_220 });
  });

  it("says counting hasn't started before the first request", async () => {
    await prisma().aiUsage.deleteMany();
    expect(await loadUsage("30d", now)).toMatchObject({ figures: { total: { requests: 0 } }, countingSince: null });
  });
});
