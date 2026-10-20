import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

import { writeEmailJob } from "./write-email";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/profile-data", async () => {
  const { demoProfile } = await import("@/lib/demo-profile");
  return { loadProfile: async () => demoProfile() };
});
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };
const where = { applicationId_kind: { applicationId: "app-1", kind: "EMAIL" as const } };
const letter = [
  { id: "sender", label: "Sender", text: "Jane Doe\njane@example.com · +31 6 1234 5678" },
  { id: "paragraph:1", label: "Opening", text: "Payments are where trust is won." },
];

const answer = (extra: object = {}) => ({
  contactName: "John Doe",
  contactEmail: "john@example.com",
  subject: "Application: Senior Product Designer",
  greeting: "Dear John,",
  paragraphs: ["I'm applying for the Senior Product Designer role. My resume and cover letter are attached."],
  signOff: "Warm regards,",
  ...extra,
});

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      company: "Ledgerly",
      role: "Senior Product Designer",
      language: "Dutch",
      postingText: "Ledgerly is hiring a Senior Product Designer. Send your application to john@example.com.",
      documents: { create: [{ kind: "COVER_LETTER", units: letter }] },
    },
  });
});
afterAll(() => prisma().$disconnect());

describe("writeEmailJob", () => {
  it("writes the email as a document with a version, in the application's language", async () => {
    const mock = new MockProvider({ reply: () => answer() });
    provider.current = mock;
    const result = await writeEmailJob.run({ applicationId: "app-1" }, context);

    const document = await prisma().document.findUniqueOrThrow({ where, include: { versions: true } });
    expect(result).toEqual({ units: document.units, previous: null });
    expect(document.units).toMatchObject([
      { id: "to", text: "John Doe <john@example.com>" },
      { id: "subject", text: "Application: Senior Product Designer" },
      { id: "body", text: expect.stringMatching(/^Dear John,\n\nI'm applying/) },
    ]);
    expect(document.writtenWith).toBe("write-email@1");
    expect(document.versions.map((version) => version.cause)).toEqual(["WRITTEN"]);
    const prompt = JSON.stringify(mock.calls[0]);
    expect(prompt).toMatch(/Dutch/);
    // The letter's paragraphs go along; its sender's contact details never do.
    expect(prompt).toContain("Payments are where trust is won.");
    expect(prompt).not.toContain("jane@example.com");
  });

  it("writes over the email it had, keeping a recipient typed in, and returns the old one for Undo", async () => {
    const typed = [
      { id: "to", label: "Recipient", text: "jobs@example.com" },
      { id: "subject", label: "Subject", text: "Old subject" },
      { id: "body", label: "Message", text: "Old message" },
    ];
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: typed } });
    provider.current = new MockProvider({ reply: () => answer({ contactEmail: null, contactName: null }) });
    const result = await writeEmailJob.run({ applicationId: "app-1" }, context);

    expect(result.previous).toEqual(typed);
    const document = await prisma().document.findUniqueOrThrow({ where, include: { versions: true } });
    expect(document.units).toMatchObject([{ id: "to", text: "jobs@example.com" }, { id: "subject", text: "Application: Senior Product Designer" }, { id: "body" }]);
    expect(result.units).toEqual(document.units);
    expect(document.versions.map((version) => version.cause)).toEqual(["WRITTEN"]);
  });
});
