import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { createTestClient, resetDatabase } from "@/test/db";

import { writeDocumentJob } from "./write-document";

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
  return { loadProfile: async () => demoProfile(), loadFactTexts: async () => ["Relocating in January."] };
});
vi.mock("@/lib/settings-data", () => ({
  loadSettings: async () => ({ dateFormat: "DAY_MONTH_YEAR", docLanguage: null }),
}));
vi.mock("@/lib/profiles", () => ({
  loadProfileSettings: async () => ({ resumeSections: { order: [], off: [] }, skillOrder: "auto", baseThemeId: null }),
}));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      company: "Ledgerly",
      role: "Designer",
      location: "Amsterdam",
      language: "English",
      postingText: "Ledgerly is hiring a Designer in Amsterdam.",
      // Created with the resume only (#367).
      documents: { create: [{ kind: "RESUME", units: [{ id: "summary", label: "Summary", text: "Designer." }] }] },
    },
  });
  provider.current = new MockProvider({
    reply: () => ({ recipient: "Ledgerly · Hiring team\nAmsterdam", greeting: "Dear Ledgerly team,", paragraphs: [{ label: "Opening", text: "I'd love to join Ledgerly." }], signOff: "Warm regards," }),
  });
});
afterAll(() => prisma().$disconnect());

describe("writeDocumentJob (#367)", () => {
  it("writes the cover letter an application was created without, with its frame and a first version", async () => {
    await writeDocumentJob.run({ applicationId: "app-1", kind: "COVER_LETTER" }, context);
    const letter = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } }, include: { versions: true } });
    expect(letter.writtenWith).toBe("write-cover-letter@7");
    expect((letter.units as { id: string }[]).map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "paragraph:1", "sign-off", "signature"]);
    expect(letter.versions.map((version) => version.cause)).toEqual(["WRITTEN"]);
  });

  it("leaves a document that's there alone", async () => {
    const mock = new MockProvider({ reply: () => ({}) });
    provider.current = mock;
    await writeDocumentJob.run({ applicationId: "app-1", kind: "RESUME" }, context);
    expect(mock.calls).toHaveLength(0);
    expect(await prisma().document.count({ where: { applicationId: "app-1" } })).toBe(1);
  });

  it("writes the letter again over the one there, in its tone and language, as a version of its own (E30-9)", async () => {
    await prisma().document.create({ data: { applicationId: "app-1", kind: "COVER_LETTER", units: [{ id: "paragraph:1", label: "Opening", text: "Old letter." }] } });
    await prisma().application.update({ where: { id: "app-1" }, data: { tone: "FORMAL", language: "Dutch" } });
    const mock = new MockProvider({ reply: () => ({ recipient: "Ledgerly", greeting: "Beste team,", paragraphs: [{ label: "Opening", text: "Graag kom ik bij Ledgerly werken." }], signOff: "Met vriendelijke groet," }) });
    provider.current = mock;
    await writeDocumentJob.run({ applicationId: "app-1", kind: "COVER_LETTER", rewrite: true }, context);
    expect(mock.calls).toHaveLength(1);
    const letter = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } }, include: { versions: true } });
    expect(JSON.stringify(letter.units)).toContain("Graag kom ik bij Ledgerly werken.");
    expect(letter.versions.map((version) => [version.cause, version.detail])).toEqual([["REGENERATED", "the letter, in Dutch and a formal tone"]]);
  });
});
