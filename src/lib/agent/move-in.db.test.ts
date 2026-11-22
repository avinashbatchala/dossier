import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FILTERS, FOUND_BY_AGENT, EMPTY_QUERY } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { listLibrary } from "../library";
import { dismissPosting, savePosting, unmarkPosting } from "../postings";

import { moveAgentFinds } from "./move-in";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;
const now = new Date("2026-11-15T10:00:00.000Z");
const at = new Date("2026-11-01T06:00:00.000Z");

const candidate = (externalId: string, data: Record<string, unknown> = {}) =>
  prisma().agentCandidate.create({
    data: {
      source: "JSEARCH",
      externalId,
      dedupeKey: externalId,
      title: `Designer ${externalId}`,
      company: `Company ${externalId}`,
      place: "Hamburg",
      url: `https://jobs.example/${externalId}`,
      description: `All of ${externalId}.`,
      complete: true,
      score: 80,
      reasons: [`Fits ${externalId}.`],
      redFlags: [],
      createdAt: at,
      ...data,
    },
  });
const finds = (filters = { ...DEFAULT_FILTERS, found: FOUND_BY_AGENT }) => listLibrary(filters, { now }).then(({ postings }) => postings);

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("what the agent found before E22-8", () => {
  it("joins Positions once, seen, with its score and the agent searches that found it", async () => {
    const search = await prisma().agentSearch.create({ data: { name: "Designers", query: { ...EMPTY_QUERY, keywords: "designer", country: "de" } } });
    const scored = await candidate("a", { score: 91 });
    await prisma().agentCandidateSearch.create({ data: { candidateId: scored.id, searchId: search.id, searchName: "Designers, then" } });
    await candidate("b", { score: 60 });
    await candidate("gone", { status: "DISMISSED", description: "", url: "" });
    // One already in Positions keeps what the user did with it.
    const saved = await candidate("saved", { score: 70 });
    await savePosting({ source: "JSEARCH", externalId: "saved", title: "Designer saved", company: "Company saved", place: "Hamburg", remote: null, salary: "", postedAt: null, url: "", via: "", description: "Saved text.", complete: true });

    expect(await moveAgentFinds()).toBe(4);
    expect(await moveAgentFinds()).toBe(0);

    // Scores from before kept no breakdown, so nothing orders them by fit (E32-2): sorted here.
    const shown = (await finds()).toSorted((a, b) => a.externalId.localeCompare(b.externalId));
    expect(shown.map((posting) => [posting.externalId, posting.state.score?.score, posting.state.agentSearches])).toEqual([
      ["a", 91, ["Designers, then"]],
      ["b", 60, [""]],
      ["saved", 70, [""]],
    ]);
    expect(shown[0].state).toMatchObject({ new: false, agent: { candidateId: scored.id, status: "SCORED" } });
    expect(shown[2].state).toMatchObject({ saved: true, agent: { candidateId: saved.id } });
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "gone" } })).toMatchObject({ dismissedAt: expect.any(Date), description: "" });
    // Its runs aren't searches of the user's.
    expect(await prisma().postingSearch.findMany({ select: { agentSearchId: true, agentSearchName: true, found: true }, orderBy: { agentSearchName: "asc" } })).toEqual([
      { agentSearchId: null, agentSearchName: "", found: 3 },
      { agentSearchId: search.id, agentSearchName: "Designers, then", found: 1 },
    ]);
  });
});

describe("dismissing what the agent found in Positions (E22-8)", () => {
  it("takes it out of the agent's queue, and Undo puts it back", async () => {
    const found = await candidate("a");
    await moveAgentFinds();
    const [posting] = await finds();
    await dismissPosting(posting);
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: found.id } })).toMatchObject({ status: "DISMISSED", description: "All of a." });
    await unmarkPosting(posting, "dismissed");
    expect(await prisma().agentCandidate.findUniqueOrThrow({ where: { id: found.id } })).toMatchObject({ status: "SCORED" });
  });
});
