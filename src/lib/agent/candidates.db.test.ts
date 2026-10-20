import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import type { FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { agentDedupeKey, candidateData, DISMISSED_TRIM, stringsOf } from "./candidates";

const db = createTestClient();
beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const posting: FoundPosting = {
  source: "JSEARCH",
  externalId: "job-1",
  title: "Data Scientist",
  company: "Ledgerly",
  place: "Berlin",
  remote: false,
  salary: "€70k",
  postedAt: "2026-10-19T00:00:00.000Z",
  url: "https://www.linkedin.com/jobs/view/123?trackingId=abc&utm_source=x",
  via: "LinkedIn",
  description: "We're hiring a data scientist.",
  complete: true,
};
const score = { score: 82, reasons: ["Python matches"], redFlags: [] };
const duplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

describe("the dedupe key (E16-1)", () => {
  it("is the same for the same link, whatever the tracking parameters or the source", () => {
    const elsewhere = { ...posting, source: "ADZUNA" as const, externalId: "az-9", url: "https://linkedin.com/jobs/view/123/?refId=y" };
    expect(agentDedupeKey(elsewhere)).toBe(agentDedupeKey(posting));
    expect(agentDedupeKey({ ...posting, url: "https://linkedin.com/jobs/view/456" })).not.toBe(agentDedupeKey(posting));
  });

  it("falls back to company, title and place, normalised, and then to the source's id", () => {
    const noLink = { ...posting, url: "" };
    expect(agentDedupeKey({ ...noLink, company: "  LEDGERLY ", title: "Data-Scientist", externalId: "other" })).toBe(agentDedupeKey(noLink));
    expect(agentDedupeKey({ ...noLink, place: "Hamburg" })).not.toBe(agentDedupeKey(noLink));
    const bare = { ...noLink, title: "", company: "", place: "" };
    expect(agentDedupeKey(bare)).not.toBe(agentDedupeKey({ ...bare, externalId: "job-2" }));
    expect(agentDedupeKey(posting)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("agent candidates (E16-1)", () => {
  it("are unique by source and the source's id, and by dedupe key", async () => {
    await db.agentCandidate.create({ data: candidateData(posting, score) });
    await expect(db.agentCandidate.create({ data: { ...candidateData(posting, score), dedupeKey: "other" } })).rejects.toSatisfy(duplicate);
    await expect(db.agentCandidate.create({ data: { ...candidateData(posting, score), externalId: "job-2" } })).rejects.toSatisfy(duplicate);
  });

  it("have at most one draft each, and outlive it", async () => {
    const application = await db.application.create({ data: { title: "Data Scientist · Ledgerly", origin: "AGENT", agentScore: 82, awaitingReview: true } });
    const linked = (data: Prisma.AgentCandidateCreateInput): Prisma.AgentCandidateUncheckedCreateInput => ({ ...data, applicationId: application.id });
    const candidate = await db.agentCandidate.create({ data: linked(candidateData(posting, score)) });
    await expect(db.agentCandidate.create({ data: linked(candidateData({ ...posting, externalId: "job-2", url: "" }, score)) })).rejects.toSatisfy(duplicate);
    await db.application.delete({ where: { id: application.id } });
    expect(await db.agentCandidate.findUniqueOrThrow({ where: { id: candidate.id } })).toMatchObject({ applicationId: null, status: "SCORED" });
  });

  it("keep only what dedupe needs once dismissed", async () => {
    const candidate = await db.agentCandidate.create({ data: candidateData(posting, { ...score, redFlags: ["German required"] }) });
    expect(stringsOf(candidate.reasons)).toEqual(["Python matches"]);
    const trimmed = await db.agentCandidate.update({ where: { id: candidate.id }, data: { status: "DISMISSED", ...DISMISSED_TRIM } });
    expect(trimmed).toMatchObject({ source: "JSEARCH", externalId: "job-1", title: "Data Scientist", company: "Ledgerly", dedupeKey: candidate.dedupeKey });
    expect(trimmed).toMatchObject({ description: "", url: "", place: "", salary: "", via: "", postedAt: null });
    expect([stringsOf(trimmed.reasons), stringsOf(trimmed.redFlags)]).toEqual([[], []]);
  });

  it("start applications as the user's own unless the agent made them", async () => {
    expect(await db.application.create({ data: {} })).toMatchObject({ origin: "MANUAL", agentScore: null, awaitingReview: false });
  });
});
