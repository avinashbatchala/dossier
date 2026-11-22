import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const ai = vi.hoisted(() => ({ usable: false, complete: vi.fn(async () => "  “Keep going, gently.”  ") }));
vi.mock("@/lib/ai/config", async (original) => ({ ...(await original<typeof import("@/lib/ai/config")>()), isAiUsable: async () => ai.usable }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ kind: "MOCK", model: "fake", complete: ai.complete }) }));

const { DAILY_NOTE_REWRITES, hideNote, noteDay, NOTE_TEMPLATES, noteState, pickTemplate, writeNote } = await import("./daily-note");
const { loadSettings, saveSettings } = await import("./settings-data");

const prisma = () => db.client!;
// Monday 16 November 2026, 10:00 in Berlin.
const now = new Date("2026-11-16T09:00:00Z");
const timeZone = "Europe/Berlin";

beforeEach(async () => {
  await resetDatabase(prisma());
  ai.usable = false;
  ai.complete.mockClear();
});
afterAll(() => prisma().$disconnect());

describe("the daily note (E28-6)", () => {
  it("writes today's note once, from the written ones without a provider", async () => {
    const first = await writeNote({ timeZone, another: false, now });
    expect(first).toEqual({ text: pickTemplate("2026-11-16", 0), rewritesLeft: DAILY_NOTE_REWRITES });
    expect(NOTE_TEMPLATES).toContain((first as { text: string }).text);
    // Asked again (a second tab, a reload): the same note.
    expect(await writeNote({ timeZone, another: false, now })).toEqual(first);
    expect((await loadSettings()).dailyNote).toMatchObject({ day: "2026-11-16", rewrites: 0, hidden: false });
  });

  it("gives another one up to three times a day, each different from the one before", async () => {
    let previous = (await writeNote({ timeZone, another: false, now })) as { text: string };
    for (let left = DAILY_NOTE_REWRITES - 1; left >= 0; left -= 1) {
      const next = (await writeNote({ timeZone, another: true, now })) as { text: string; rewritesLeft: number };
      expect(next.text).not.toBe(previous.text);
      expect(next.rewritesLeft).toBe(left);
      previous = next;
    }
    expect(await writeNote({ timeZone, another: true, now })).toEqual({ text: previous.text, rewritesLeft: 0 });
  });

  it("asks the AI when it may, with nothing about the user, and tidies its answer", async () => {
    ai.usable = true;
    await saveSettings({ dailyNoteAi: true });
    expect(await writeNote({ timeZone, another: false, now })).toEqual({ text: "Keep going, gently.", rewritesLeft: DAILY_NOTE_REWRITES });
    const [request] = ai.complete.mock.calls[0] as unknown as [{ task: string; messages: { content: string }[] }];
    expect(request.task).toBe("daily-note");
    expect(request.messages[0].content).toMatch(/^Today's note is about /);
  });

  it("falls back to a written note when the AI fails, or is switched off", async () => {
    ai.usable = true;
    ai.complete.mockRejectedValueOnce(new Error("timeout"));
    expect(NOTE_TEMPLATES).toContain(((await writeNote({ timeZone, another: false, now })) as { text: string }).text);

    await saveSettings({ dailyNote: null, dailyNoteAi: false });
    ai.complete.mockClear();
    await writeNote({ timeZone, another: false, now });
    expect(ai.complete).not.toHaveBeenCalled();
  });

  it("hides until the day changes in the user's time zone, and starts over the next day", async () => {
    await writeNote({ timeZone, another: false, now });
    await hideNote({ timeZone, now });
    expect(noteState((await loadSettings()).dailyNote, noteDay(now, timeZone))).toBe("hidden");
    // 23:30 in Berlin is still the 16th.
    expect(noteState((await loadSettings()).dailyNote, noteDay(new Date("2026-11-16T22:30:00Z"), timeZone))).toBe("hidden");
    // The 17th: nothing written yet.
    const tomorrow = new Date("2026-11-16T23:30:00Z");
    expect(noteState((await loadSettings()).dailyNote, noteDay(tomorrow, timeZone))).toBeNull();
    expect(await writeNote({ timeZone, another: false, now: tomorrow })).toMatchObject({ rewritesLeft: DAILY_NOTE_REWRITES });
  });
});
