import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { emit } from "@/lib/notifications/notify";
import { createTestClient, resetDatabase } from "@/test/db";

import { WRITE_APPLICATION_STEPS } from "./application-steps";
import { writeApplicationJob } from "./write-application";

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
  loadSettings: async () => ({ dateFormat: "DAY_MONTH_YEAR", docLanguage: null, includeRefs: true, strict: true, showDiff: true }),
}));
vi.mock("@/lib/profiles", () => ({
  loadProfileSettings: async () => ({ resumeSections: { order: [], off: [] }, skillOrder: "auto", baseThemeId: null }),
}));
vi.mock("@/lib/notifications/notify", () => ({ emit: vi.fn(async () => 1) }));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const context = (steps: string[] = []) => ({ id: "test-job", step: async (name: string) => void steps.push(name), signal: new AbortController().signal });

const LETTER = { recipient: "Ledgerly · Hiring team\nAmsterdam", greeting: "Dear Ledgerly team,", paragraphs: [{ label: "Opening", text: "I'd love to join Ledgerly." }], signOff: "Warm regards," };
const RESUME = { summary: "Designer who makes payments calm.", roles: [], projects: [], skills: [], education: [] };

beforeEach(async () => {
  await resetDatabase(prisma());
  vi.mocked(emit).mockClear();
  await prisma().application.create({
    data: { id: "app-1", title: "Designer · Ledgerly", company: "Ledgerly", role: "Designer", location: "Amsterdam", language: "English", postingText: "Ledgerly is hiring a Designer in Amsterdam." },
  });
  provider.current = new MockProvider({ reply: (call) => (call.json?.name === "tailored_resume" ? RESUME : LETTER) });
});
afterAll(() => prisma().$disconnect());

describe("writeApplicationJob (E31-4)", () => {
  it("writes the resume, then the letter, into the Draft through five steps, and says so when it's done", async () => {
    const steps: string[] = [];
    await writeApplicationJob.run({ applicationId: "app-1", write: "both" }, context(steps));
    expect(steps).toEqual([...WRITE_APPLICATION_STEPS]);
    const documents = await prisma().document.findMany({ where: { applicationId: "app-1" }, include: { versions: true } });
    expect(documents.map((document) => [document.kind, document.writtenWith, document.versions.map((version) => version.cause)]).sort()).toEqual([
      ["COVER_LETTER", "write-cover-letter@7", ["WRITTEN"]],
      ["RESUME", "tailor-resume@10", ["WRITTEN"]],
    ]);
    const letter = documents.find((document) => document.kind === "COVER_LETTER")!;
    expect((letter.units as { id: string }[]).map((unit) => unit.id)).toEqual(["sender", "date", "recipient", "greeting", "paragraph:1", "sign-off", "signature"]);
    // The opening message, with what the guard found and the note taken into account.
    const [message] = await prisma().chatMessage.findMany({ where: { applicationId: "app-1" } });
    expect(message.text).toMatch(/^Here's what I tailored for Ledgerly:/);
    expect(message.text).toContain("Took your note into account: “Relocating in January.”");
    expect(emit).toHaveBeenCalledWith("documents.written", { applicationId: "app-1", title: "Designer", company: "Ledgerly", resume: true, letter: true });
  });

  it("writes only the one asked for, skipping its step", async () => {
    const steps: string[] = [];
    await writeApplicationJob.run({ applicationId: "app-1", write: "letter" }, context(steps));
    expect(steps).toEqual([WRITE_APPLICATION_STEPS[0], WRITE_APPLICATION_STEPS[1], WRITE_APPLICATION_STEPS[3], WRITE_APPLICATION_STEPS[4]]);
    expect(await prisma().document.findMany({ where: { applicationId: "app-1" }, select: { kind: true } })).toEqual([{ kind: "COVER_LETTER" }]);
    expect(emit).toHaveBeenCalledWith("documents.written", expect.objectContaining({ resume: false, letter: true }));
  });

  it("keeps the resume when the letter fails, and a retry writes only the letter", async () => {
    let failing = true;
    provider.current = new MockProvider({
      reply: (call) => {
        if (call.json?.name === "tailored_resume") return RESUME;
        if (failing) throw new Error("The model took too long to answer.");
        return LETTER;
      },
    });
    await expect(writeApplicationJob.run({ applicationId: "app-1", write: "both" }, context())).rejects.toThrow();
    expect(await prisma().document.findMany({ where: { applicationId: "app-1" }, select: { kind: true } })).toEqual([{ kind: "RESUME" }]);
    expect(emit).not.toHaveBeenCalled();

    failing = false;
    const mock = provider.current as MockProvider;
    const before = mock.calls.length;
    await writeApplicationJob.run({ applicationId: "app-1", write: "both" }, context());
    expect(mock.calls.slice(before).map((call) => call.json?.name)).toEqual(["cover_letter"]);
    expect(await prisma().document.count({ where: { applicationId: "app-1" } })).toBe(2);
    expect(emit).toHaveBeenCalledWith("documents.written", expect.objectContaining({ resume: true, letter: true }));
  });
});
