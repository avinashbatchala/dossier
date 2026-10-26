import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { sweepFinishedJobs } from "@/lib/jobs/retention";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { handOffFoundPosting, handOffPastedPosting, handsOffToClaude, PASTE_DAYS, readPastedPosting } from "./handoff";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/job-search/find", () => ({ fullText: vi.fn(async () => "The whole text") }));
vi.mock("@/lib/jobs/zip-pdfs", () => ({ removeOldZips: async () => {} }));

const prisma = () => db.client!;
const promptOf = (url: string) => new URL(url).searchParams.get("q")!;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("handing work to Claude chat (#221)", () => {
  it("only happens with the connector on and no AI model of Dossier's own", async () => {
    expect(await handsOffToClaude(false)).toBe(false);
    await saveSettings({ connectorEnabledAt: "2026-10-23T09:00:00.000Z" });
    expect(await handsOffToClaude(false)).toBe(true);
    expect(await handsOffToClaude(true)).toBe(false);
  });

  it("names a Find jobs posting by its id, kept with its whole text, for the connector's tools", async () => {
    const posting = {
      source: "JSEARCH",
      externalId: "j1",
      title: "Product Designer",
      company: "Acme",
      place: "Berlin",
      remote: null,
      salary: "",
      postedAt: null,
      url: "",
      via: "",
      description: "Figma",
      complete: false,
    } as const;
    const write = await handOffFoundPosting(posting, "write");
    const stored = await prisma().posting.findFirstOrThrow({ where: { externalId: "j1" } });
    expect(stored).toMatchObject({ description: "The whole text", complete: true });
    expect(write).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    expect(promptOf(write)).toContain(`posting_id "${stored.id}" (Product Designer at Acme)`);
    expect(promptOf(write)).toContain("save_application");
    expect(promptOf(await handOffFoundPosting(posting, "score"))).toContain("save_job_scores");
    expect(write.length).toBeLessThan(2000);
  });

  it("keeps a pasted posting for Claude for 14 days, however long, then the sweep deletes it", async () => {
    const text = "Senior Product Designer. ".repeat(500);
    const now = new Date("2026-10-23T09:00:00Z");
    const url = await handOffPastedPosting({ text, url: "https://jobs.example/1" }, now);
    const id = /paste_id "([^"]+)"/.exec(promptOf(url))![1];
    expect(url.length).toBeLessThan(2000);
    expect(await readPastedPosting(id, now)).toEqual({ text, url: "https://jobs.example/1" });
    expect(await readPastedPosting("../nope", now)).toBeNull();

    const later = new Date(now.getTime() + PASTE_DAYS * DAY + 1);
    expect(await readPastedPosting(id, later)).toBeNull();
    await sweepFinishedJobs(later, 24);
    expect(await prisma().claudePaste.count()).toBe(0);
  });
});
