import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PostingSource } from "@/generated/prisma/enums";
import { JOB_SOURCES, type FoundPosting } from "@/lib/job-search/search";
import { createTestClient, resetDatabase } from "@/test/db";

import { countPostings, dismissPosting, foundFromPosting, listPostings, postingStates, savePosting, storePosting, unmarkPosting } from "./postings";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

const found: FoundPosting = {
  source: "JSEARCH",
  externalId: "job-1",
  title: "UX Researcher",
  company: "Northwind Studio",
  place: "Berlin",
  remote: true,
  salary: "",
  postedAt: "2026-09-28T00:00:00.000Z",
  url: "https://www.linkedin.com/jobs/view/123?trackingId=abc&refId=x",
  via: "LinkedIn",
  description: "The whole posting.",
  complete: true,
};
const ref = { source: found.source, externalId: found.externalId };

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("postings", () => {
  it("lists the same sources as the schema's enum", () => {
    expect([...JOB_SOURCES].sort()).toEqual(Object.values(PostingSource).sort());
  });

  it("saves a posting with everything the screen needs, and reads it back in the same shape", async () => {
    const saved = await savePosting(found);
    expect(saved).toMatchObject({ source: "JSEARCH", externalId: "job-1", title: "UX Researcher", savedAt: expect.any(Date), dismissedAt: null });
    expect(foundFromPosting(saved)).toEqual(found);
  });

  it("keeps the saved date and a whole description when the posting comes again", async () => {
    const first = await savePosting(found);
    const again = await storePosting({ ...found, title: "Senior UX Researcher", description: "The start…", complete: false });
    expect(again).toMatchObject({ title: "Senior UX Researcher", description: "The whole posting.", complete: true, savedAt: first.savedAt });
    const fuller = await storePosting({ ...found, description: "An even longer posting." });
    expect(fuller.description).toBe("An even longer posting.");
    expect(await prisma().posting.count()).toBe(1);
  });

  it("dismissing takes a posting out of Saved; Undo can put it back", async () => {
    await savePosting(found);
    expect(await dismissPosting(found)).toEqual({ wasSaved: true });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ savedAt: null, dismissedAt: expect.any(Date) });

    await unmarkPosting(ref, "dismissed", { saved: true });
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ savedAt: expect.any(Date), dismissedAt: null });
  });

  it("removes a posting left with no reason to be kept, but not one with an application", async () => {
    await savePosting(found);
    await unmarkPosting(ref, "saved");
    expect(await prisma().posting.count()).toBe(0);

    expect(await dismissPosting(found)).toEqual({ wasSaved: false });
    await unmarkPosting(ref, "dismissed");
    expect(await prisma().posting.count()).toBe(0);

    const application = await prisma().application.create({ data: { title: "UX Researcher · Northwind" } });
    await prisma().posting.update({ where: { id: (await savePosting(found)).id }, data: { applicationId: application.id } });
    await unmarkPosting(ref, "saved");
    expect(await prisma().posting.findFirstOrThrow()).toMatchObject({ savedAt: null, applicationId: application.id });

    // Nothing to do for a posting that isn't stored.
    await unmarkPosting({ source: "ADZUNA", externalId: "nope" }, "saved");
  });

  it("keeps the posting when its application is deleted", async () => {
    const application = await prisma().application.create({ data: { title: "UX Researcher · Northwind" } });
    const posting = await storePosting(found);
    await prisma().posting.update({ where: { id: posting.id }, data: { applicationId: application.id } });
    await prisma().application.delete({ where: { id: application.id } });
    expect(await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).toMatchObject({ applicationId: null });
  });
});

describe("the Saved and Dismissed views (E14-7)", () => {
  it("lists saved and dismissed postings, newest first, and counts them", async () => {
    const application = await prisma().application.create({ data: { title: "From Find jobs" } });
    await savePosting({ ...found, externalId: "older", title: "Older" });
    await prisma().posting.update({ where: { source_externalId: { source: "JSEARCH", externalId: "older" } }, data: { savedAt: new Date("2026-09-01"), applicationId: application.id } });
    await savePosting({ ...found, externalId: "newer", title: "Newer" });
    await dismissPosting({ ...found, externalId: "gone", title: "Not for me" });

    const saved = await listPostings("saved");
    expect(saved.map((posting) => [posting.title, posting.state.applicationId])).toEqual([
      ["Newer", null],
      ["Older", application.id],
    ]);
    expect(saved[0].state).toMatchObject({ postingId: expect.any(String), saved: true, dismissed: false });
    expect((await listPostings("dismissed")).map((posting) => posting.title)).toEqual(["Not for me"]);
    expect(await countPostings()).toEqual({ saved: 2, dismissed: 1 });
  });
});

describe("postingStates", () => {
  it("says which results are saved, dismissed or applied to", async () => {
    const other = { ...found, externalId: "job-2", url: "https://jobs.example/2" };
    const third = { ...found, externalId: "job-3", url: "https://jobs.example/3" };
    const application = await prisma().application.create({ data: { title: "From Find jobs" } });
    await savePosting(found);
    await dismissPosting(other);
    await prisma().posting.update({ where: { source_externalId: ref }, data: { applicationId: application.id } });

    const states = await postingStates([found, other, third]);
    expect(states.get("JSEARCH:job-1")).toEqual({ postingId: expect.any(String), saved: true, dismissed: false, applicationId: application.id, score: null });
    expect(states.get("JSEARCH:job-2")).toEqual({ postingId: expect.any(String), saved: false, dismissed: true, applicationId: null, score: null });
    expect(states.get("JSEARCH:job-3")).toEqual({ postingId: null, saved: false, dismissed: false, applicationId: null, score: null });
  });

  it("counts applications made from the same link before Find jobs, ignoring tracking", async () => {
    const earlier = await prisma().application.create({
      data: { title: "Pasted earlier", postingUrl: "https://linkedin.com/jobs/view/123/?utm_source=newsletter" },
    });
    await prisma().application.create({ data: { title: "No link" } });
    const states = await postingStates([found]);
    expect(states.get("JSEARCH:job-1")).toMatchObject({ postingId: null, applicationId: earlier.id });
  });

  it("has each result's score, scored or not (#208)", async () => {
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "job-1", score: 82, reasons: ["Research"], redFlags: [], scoredWith: "score-posting@1" } });
    const states = await postingStates([found, { ...found, externalId: "job-2" }]);
    expect(states.get("JSEARCH:job-1")?.score).toEqual({ score: 82, reasons: ["Research"], redFlags: [] });
    expect(states.get("JSEARCH:job-2")?.score).toBeNull();
  });

  it("asks nothing for no results", async () => {
    expect(await postingStates([])).toEqual(new Map());
  });
});
