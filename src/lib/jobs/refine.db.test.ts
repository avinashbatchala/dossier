import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";
import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { refineJob } from "./refine";

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
const resume = demoResumeUnits();
const letter = [...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Warm regards," }];
const context = { id: "test-job", step: async () => {}, signal: new AbortController().signal };
const reply = (answer: object) => new MockProvider({ reply: () => ({ edits: [], tone: null, declined: false, ...answer }) });

async function ask(request: string, extra: { target?: { document: "RESUME" | "COVER_LETTER"; unitId: string } | null } = {}) {
  const message = await prisma().chatMessage.create({ data: { applicationId: "app-1", role: "USER", text: request } });
  return refineJob.run({ applicationId: "app-1", messageId: message.id, request, target: extra.target ?? null, viewing: "RESUME" }, context);
}
const units = async (kind: "RESUME" | "COVER_LETTER") =>
  (await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind } } })).units as typeof resume;
const lastMessage = () => prisma().chatMessage.findFirstOrThrow({ where: { applicationId: "app-1" }, orderBy: { createdAt: "desc" } });

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({
    data: {
      id: "app-1",
      company: "Ledgerly",
      tone: "WARM",
      language: "English",
      postingText: "Ledgerly is hiring a Senior Product Designer.",
      documents: { create: [{ kind: "RESUME", units: resume }, { kind: "COVER_LETTER", units: letter }] },
      messages: { create: { role: "AI", text: "Here's what I tailored for Ledgerly.", createdAt: new Date(Date.now() - 60_000) } },
    },
  });
});
afterAll(() => prisma().$disconnect());

describe("refineJob (E8-5)", () => {
  it("applies the edits and saves the reply with them, for Undo", async () => {
    provider.current = reply({ reply: "Trimmed your summary.", edits: [{ document: "RESUME", unitId: "summary", text: "Designer of calm tools." }] });
    const result = await ask("Make the summary shorter");

    const saved = await lastMessage();
    expect(result).toEqual({ messageId: saved.id, edited: [{ document: "RESUME", unitId: "summary" }] });
    // A version of the resume as changed, named by the request (E8-10).
    expect(await prisma().documentVersion.findMany({ select: { cause: true, detail: true } })).toEqual([{ cause: "REFINED", detail: "Make the summary shorter" }]);
    expect(saved).toMatchObject({
      role: "AI",
      text: "Trimmed your summary.",
      writtenWith: "refine-chat@5",
      previousTone: null,
      edits: [{ document: "RESUME", unitId: "summary", text: "Designer of calm tools.", previousText: resume[0].text }],
    });
    expect((await units("RESUME"))[0].text).toBe("Designer of calm tools.");
  });

  it("edits the email, which the model sees once there is one", async () => {
    const email = [
      { id: "to", label: "Recipient", text: "John Doe <john@example.com>" },
      { id: "subject", label: "Subject", text: "Application" },
      { id: "body", label: "Message", text: "Dear John,\n\nHello." },
    ];
    await prisma().document.create({ data: { applicationId: "app-1", kind: "EMAIL", units: email } });
    const mock = reply({ reply: "Shorter now.", edits: [{ document: "EMAIL", unitId: "body", text: "Dear John,\n\nHi." }] });
    provider.current = mock;
    expect(await ask("Make the email shorter")).toMatchObject({ edited: [{ document: "EMAIL", unitId: "body" }] });
    expect(JSON.stringify(mock.calls[0])).toContain("The email's units");
    const saved = await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "app-1", kind: "EMAIL" } } });
    // The greeting's name is the recipient's, so the fact guard lets it be.
    expect(saved.units).toEqual([email[0], email[1], { ...email[2], text: "Dear John,\n\nHi." }]);
  });

  it("changes the letter's tone and its sign-off, remembering the old tone", async () => {
    provider.current = reply({ reply: "Made it formal.", tone: "FORMAL" });
    await ask("Make it more formal");
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "app-1" } })).toMatchObject({ tone: "FORMAL" });
    expect(await lastMessage()).toMatchObject({ previousTone: "WARM" });
    expect((await units("COVER_LETTER")).at(-1)).toMatchObject({ id: "sign-off", text: "Kind regards," });
  });

  it("declines without touching the documents (APP-9)", async () => {
    provider.current = reply({
      reply: "Your profile doesn't mention Kubernetes yet, so I've left it out.",
      edits: [{ document: "RESUME", unitId: "summary", text: "Kubernetes expert." }],
      declined: true,
    });
    expect(await ask("Say I know Kubernetes")).toMatchObject({ edited: [] });
    expect(await lastMessage()).toMatchObject({ text: "Your profile doesn't mention Kubernetes yet, so I've left it out.", edits: null });
    expect(await units("RESUME")).toEqual(resume);
  });

  it("leaves a unit that changed while it worked, and says so", async () => {
    provider.current = new MockProvider({
      reply: async () => {
        const edited = resume.map((unit) => (unit.id === "summary" ? { ...unit, text: "Mine" } : unit));
        await prisma().document.update({ where: { applicationId_kind: { applicationId: "app-1", kind: "RESUME" } }, data: { units: edited } });
        return { reply: "Tightened it.", edits: [{ document: "RESUME", unitId: "summary", text: "The AI's" }], tone: null, declined: false };
      },
    });
    expect(await ask("Shorter")).toMatchObject({ edited: [] });
    expect((await units("RESUME"))[0].text).toBe("Mine");
    expect((await lastMessage()).text).toBe("Tightened it. I left the summary as it is: it changed while I was working.");
  });

  it("sends the conversation so far and the picked unit", async () => {
    const mock = reply({ reply: "Done." });
    provider.current = mock;
    await ask("Mention payments", { target: { document: "RESUME", unitId: "summary" } });
    const messages = mock.calls[0].messages;
    expect(messages.at(-2)).toEqual({ role: "assistant", content: "Here's what I tailored for Ledgerly." });
    expect(messages.at(-1)).toEqual({ role: "user", content: "About Summary (summary): Mention payments" });
  });

  it("never sends private notes to the AI (E8-9)", async () => {
    await prisma().note.create({ data: { applicationId: "app-1", body: "Salary floor: 85k, don't mention it." } });
    const mock = reply({ reply: "Done." });
    provider.current = mock;
    await ask("Make it shorter");
    expect(JSON.stringify(mock.calls)).not.toContain("Salary floor");
  });
});

describe("the letter's contact details (E8-11)", () => {
  it("never sends the sender or signature to the model, and won't edit them", async () => {
    const framed = [
      { id: "sender", label: "Sender", text: "Jane Doe\nsecret-mail@example.com · +31 6 1234 5678" },
      { id: "greeting", label: "Greeting", text: "Dear Ledgerly team," },
      ...letter,
      { id: "signature", label: "Signature", text: "Jane Doe" },
    ];
    await prisma().document.update({ where: { applicationId_kind: { applicationId: "app-1", kind: "COVER_LETTER" } }, data: { units: framed } });
    const mock = reply({
      reply: "Done.",
      edits: [
        { document: "COVER_LETTER", unitId: "sender", text: "Someone else" },
        { document: "COVER_LETTER", unitId: "greeting", text: "Hello Ledgerly team," },
      ],
    });
    provider.current = mock;
    await ask("Make the greeting friendlier");
    const prompt = JSON.stringify(mock.calls[0]);
    expect(prompt).not.toContain("secret-mail@example.com");
    expect(prompt).not.toContain("+31 6 1234 5678");
    expect(prompt).toContain("Dear Ledgerly team,");
    const saved = await units("COVER_LETTER");
    expect(saved.find((unit) => unit.id === "sender")?.text).toBe(framed[0].text);
    expect(saved.find((unit) => unit.id === "greeting")?.text).toBe("Hello Ledgerly team,");
  });
});
