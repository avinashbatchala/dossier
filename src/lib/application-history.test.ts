import { describe, expect, it } from "vitest";

import { historyFeed, type MessageRow, type VersionRow } from "./application-history";

const at = (seconds: number) => new Date(Date.UTC(2026, 10, 16, 10, 0, seconds));
const version = (id: string, document: VersionRow["document"], cause: VersionRow["cause"], seconds: number, detail = ""): VersionRow => ({ id, document, cause, detail, createdAt: at(seconds) });
const message = (id: string, role: MessageRow["role"], text: string, seconds: number, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  role,
  text,
  hasEdits: false,
  writtenWith: null,
  createdAt: at(seconds),
  ...extra,
});

describe("historyFeed (E30-11)", () => {
  it("lists changes across both documents, newest first, numbered in each and with the one before", () => {
    const feed = historyFeed({
      versions: [
        version("r1", "RESUME", "WRITTEN", 0),
        version("l1", "COVER_LETTER", "WRITTEN", 0),
        version("r2", "RESUME", "REGENERATED", 30, "Summary"),
        version("l2", "COVER_LETTER", "REGENERATED", 40, "the letter, in Dutch and a formal tone"),
      ],
      messages: [],
    });
    expect(feed.map((entry) => entry.kind === "change" && [entry.text, entry.why, entry.versions.map((v) => `${v.document} v${v.number} after ${v.previousId}`)])).toEqual([
      ["Rewrote the letter, in Dutch and a formal tone", "Regenerated", ["COVER_LETTER v2 after l1"]],
      ["Rewrote “Summary”", "Regenerated", ["RESUME v2 after r1"]],
      ["Wrote the resume and cover letter", "Tailoring", ["RESUME v1 after null", "COVER_LETTER v1 after null"]],
    ]);
  });

  it("reads a change asked for in the chat as the AI's reply, one entry for both documents", () => {
    const feed = historyFeed({
      versions: [version("r1", "RESUME", "REFINED", 10, "Mention payments"), version("l1", "COVER_LETTER", "REFINED", 10, "Mention payments")],
      messages: [message("m1", "USER", "Mention payments", 5), message("m2", "AI", "Moved payments into the first sentence.\n\nAnything else?", 10, { hasEdits: true })],
    });
    expect(feed).toEqual([
      expect.objectContaining({
        kind: "change",
        text: "Moved payments into the first sentence.",
        why: "Asked",
        versions: [expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "l1" })],
        // Its own Undo, for documents without an earlier version.
        messageId: "m2",
      }),
    ]);
  });

  it("keeps the questions answered in Ask, which made no version", () => {
    const feed = historyFeed({
      versions: [version("r1", "RESUME", "WRITTEN", 0)],
      messages: [message("m1", "USER", "What matters most?", 20), message("m2", "AI", "Design systems.", 25, { writtenWith: "answer-question@1" })],
    });
    expect(feed[0]).toEqual({ kind: "answer", id: "m2", at: at(25).toISOString(), question: "What matters most?", text: "Design systems." });
    expect(feed).toHaveLength(2);
  });
});
