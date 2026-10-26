import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";

import { connectorDraftJob } from "./draft";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
// Dossier's own model reads the posting and writes the documents; here they're done.
const extracted = {
  title: "Product Designer · Acme",
  company: "Acme",
  role: "Product Designer",
  location: "Berlin",
  mode: "Hybrid",
  salary: null,
  deadline: "2026-11-15",
  requirements: [],
  asksForReferences: false,
  language: "English",
};
vi.mock("@/lib/jobs/read-posting", () => ({
  readPostingJob: { run: vi.fn(async () => ({ extracted, extractedWith: "extract-posting@1", match: { items: [] }, matchedWith: "match-requirements@1" })) },
}));
vi.mock("@/lib/jobs/write-documents", async () => {
  const { demoLetterUnits, demoResumeUnits } = await import("@/lib/demo-profile");
  return {
    writeDocumentsJob: {
      run: vi.fn(async () => ({
        resume: demoResumeUnits(),
        resumeWith: "tailor-resume@6",
        letter: [...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Warm regards," }],
        letterWith: "write-cover-letter@5",
      })),
    },
  };
});
vi.mock("@/lib/page-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/page-limit")>()),
  fitResumeToPages: vi.fn(async () => ({ trimmed: [], fits: true })),
}));

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
});
afterAll(() => prisma().$disconnect());

describe("a draft asked for from Claude chat (#221)", () => {
  it("reads the posting, writes the documents and makes one Draft application, linked to its posting", async () => {
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "p1", title: "Product Designer", company: "Acme" } });
    const job = await prisma().job.create({ data: { type: "connector-draft", status: "RUNNING", input: {} } });
    const context = { id: job.id, step: async () => {}, signal: new AbortController().signal };
    const input = { posting: "Product Designer at Acme, Berlin.", postingUrl: "https://jobs.example/p1", note: "Stress Figma", postingId: posting.id };

    const { applicationId } = await connectorDraftJob.run(input, context);
    const application = await prisma().application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: true, facts: true } });
    expect(application).toMatchObject({ title: "Product Designer · Acme", company: "Acme", location: "Berlin", status: "DRAFT", postingUrl: "https://jobs.example/p1" });
    expect(application.deadline?.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(application.facts.map((fact) => fact.text)).toEqual(["Stress Figma"]);
    expect(application.documents.map((document) => document.kind).sort()).toEqual(["COVER_LETTER", "RESUME"]);
    expect((application.documents.find((document) => document.kind === "RESUME")!.units as unknown[]).length).toBe(demoResumeUnits().length);
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: posting.id } })).applicationId).toBe(applicationId);

    // A retry finds the application it made rather than making a second.
    expect(await connectorDraftJob.run(input, context)).toEqual({ applicationId });
    expect(await prisma().application.count()).toBe(1);
  });
});
