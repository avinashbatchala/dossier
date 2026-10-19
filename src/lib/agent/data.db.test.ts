import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_QUERY } from "@/lib/job-search/search";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { countAgentQueue } from "./count";
import { loadAgentView } from "./data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "UTC" }));
vi.mock("@/lib/job-search/config", () => ({ loadJobSearchConfig: async () => ({ source: "JSEARCH" }) }));

const prisma = () => db.client!;
const now = new Date(2026, 9, 19, 8, 0);

beforeEach(async () => {
  await resetDatabase(prisma());
  await saveSettings({
    jobSource: "JSEARCH",
    agentEnabled: true,
    agentQuery: { ...EMPTY_QUERY, keywords: "designer", country: "nl", place: "Amsterdam" },
    agentHour: 7,
    agentMinScore: 72,
    agentMaxScores: 12,
    agentMaxDrafts: 2,
    agentAutoDraft: true,
    agentLastRunAt: now.toISOString(),
  });
});
afterAll(() => prisma().$disconnect());

describe("loadAgentView (E16)", () => {
  it("gives the screen the settings, the queue and the latest run", async () => {
    await prisma().job.create({
      data: {
        id: "run-1",
        type: "agent-scan",
        key: "agent",
        status: "DONE",
        input: { manual: false },
        result: { found: 3, fresh: 2, scored: 2, drafted: 1, skipped: 1, message: "1 draft is ready." },
      },
    });
    await prisma().agentCandidate.createMany({
      data: [
        { jobId: "run-1", source: "JSEARCH", externalId: "a", title: "Designer", company: "Ledgerly", score: 88, dedupeKey: "agent:a", reasons: ["Figma"], redFlags: ["Kubernetes"], postedAt: now },
        { jobId: "run-1", source: "JSEARCH", externalId: "b", title: "Designer", company: "Harbour", score: 80, dedupeKey: "agent:b", reasons: ["Research"], redFlags: [] },
        { jobId: "run-1", source: "JSEARCH", externalId: "c", title: "Designer", company: "Tulip", score: 75, dedupeKey: "agent:c", status: "DRAFTING" },
        { source: "JSEARCH", externalId: "d", title: "Old", company: "Gone", score: 90, dedupeKey: "agent:d", status: "APPROVED" },
        { source: "JSEARCH", externalId: "e", title: "Nope", company: "Gone", score: 95, dedupeKey: "agent:e", status: "DISMISSED" },
      ],
    });

    const view = await loadAgentView(now);
    expect(view).toMatchObject({
      enabled: true,
      source: "JSEARCH",
      searchLine: "designer · Amsterdam, 25 km",
      hour: 7,
      minScore: 72,
      maxScores: 12,
      maxDrafts: 2,
      autoDraft: true,
      job: { id: "run-1", result: { message: "1 draft is ready." } },
      counts: { scored: 2, drafting: 1, drafted: 0, waiting: 2 },
    });
    expect(view.queue.map((candidate) => candidate.company).sort()).toEqual(["Harbour", "Ledgerly", "Tulip"]);
    expect(view.queue.find((candidate) => candidate.company === "Ledgerly")).toMatchObject({
      score: 88,
      reasons: ["Figma"],
      redFlags: ["Kubernetes"],
      posted: expect.any(String),
    });
    expect(view.lastRunAt).toBe("Mon 19 Oct, 08:00");
    expect(view.nextRunAt).toBeTruthy();
    expect(view.nextRunLabel).toBeTruthy();
  });

  it("counts only postings waiting for a look on the badge", async () => {
    await prisma().agentCandidate.createMany({
      data: [
        { source: "JSEARCH", externalId: "a", score: 80, dedupeKey: "agent:a", status: "SCORED" },
        { source: "JSEARCH", externalId: "b", score: 80, dedupeKey: "agent:b", status: "DRAFTED" },
        { source: "JSEARCH", externalId: "c", score: 80, dedupeKey: "agent:c", status: "DRAFTING" },
        { source: "JSEARCH", externalId: "d", score: 80, dedupeKey: "agent:d", status: "DISMISSED" },
      ],
    });
    expect(await countAgentQueue()).toBe(2);
  });
});
