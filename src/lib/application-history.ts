import type { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { ANSWER_QUESTION_VERSION } from "@/lib/ai/tasks/answer-question";
import { DOCUMENT_LABELS } from "@/lib/file-name";

// An application's history (E30-11, AP2): one feed across its documents,
// built from their versions (E8-10), with the questions answered in Ask
// (E30-10), which make no version. Newest first.

/** A version of one of its documents, as the feed reads it. */
export type VersionRow = { id: string; document: DocumentKind; cause: VersionCause; detail: string; createdAt: Date };

/** A chat message, as the feed reads it. */
export type MessageRow = { id: string; role: "USER" | "AI"; text: string; hasEdits: boolean; writtenWith: string | null; createdAt: Date; undone?: boolean };

/** One version an entry made: "Resume v4", and the one before it, which Undo brings back. */
type EntryVersion = { document: DocumentKind; id: string; number: number; previousId: string | null };

export type HistoryEntry =
  | {
      kind: "change";
      id: string;
      /** ISO. */
      at: string;
      /** What changed: the AI's reply for a change asked for, or what was done. */
      text: string;
      /** Why: Asked, Regenerated, Tailoring… */
      why: string;
      versions: EntryVersion[];
      /** The chat reply that made it, not undone yet: its own Undo works without an earlier version. */
      messageId?: string;
    }
  | { kind: "answer"; id: string; at: string; question: string; text: string };

const WHY: Record<VersionCause, string> = {
  WRITTEN: "Tailoring",
  TRIMMED: "Page limit",
  REGENERATED: "Regenerated",
  REFINED: "Asked",
  UNDONE: "Undone",
  BEFORE_RESTORE: "Before going back",
  RESTORED: "Went back",
};

/** One change made several versions when it's the same cause and detail, saved within this long. */
const SAME_CHANGE_MS = 3_000;

const documentNames = (documents: DocumentKind[]) => {
  const names = documents.map((document) => DOCUMENT_LABELS[document].toLowerCase());
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/** What a change did, in words. */
function changeText(cause: VersionCause, detail: string, documents: DocumentKind[], reply: string | undefined): string {
  switch (cause) {
    case "WRITTEN":
      return `Wrote the ${documentNames(documents)}`;
    case "TRIMMED":
      return "Left parts out to fit the page limit";
    case "REGENERATED":
      return !detail ? "Rewrote a part" : detail.startsWith("the ") ? `Rewrote ${detail}` : `Rewrote “${detail}”`;
    case "REFINED":
      return reply ?? (detail ? `Changed: “${detail}”` : "Changed from the chat");
    case "UNDONE":
      return "Undid an AI change";
    case "BEFORE_RESTORE":
      return `Kept the ${documentNames(documents)} as it was before going back`;
    case "RESTORED":
      return "Went back to an earlier version";
  }
}

/** The first paragraph of a reply, which says what changed. */
const firstParagraph = (text: string) => text.split(/\n{2,}/)[0].trim();

/**
 * The feed, newest first. Versions saved together by one change are one
 * entry; a change asked for in the chat reads as the AI's reply. Each
 * version knows its number in its document and the one before it.
 */
export function historyFeed({ versions, messages }: { versions: readonly VersionRow[]; messages: readonly MessageRow[] }): HistoryEntry[] {
  const ordered = versions.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const counts = new Map<DocumentKind, number>();
  const last = new Map<DocumentKind, string>();
  const numbered = ordered.map((version) => {
    const number = (counts.get(version.document) ?? 0) + 1;
    counts.set(version.document, number);
    const previousId = last.get(version.document) ?? null;
    last.set(version.document, version.id);
    return { ...version, number, previousId };
  });

  const groups: (typeof numbered)[] = [];
  for (const version of numbered) {
    const group = groups.at(-1);
    const head = group?.[0];
    if (
      group &&
      head &&
      head.cause === version.cause &&
      head.detail === version.detail &&
      version.createdAt.getTime() - head.createdAt.getTime() <= SAME_CHANGE_MS &&
      !group.some((entry) => entry.document === version.document)
    ) {
      group.push(version);
    } else groups.push([version]);
  }

  // A change asked for in the chat is saved with its reply, a moment apart.
  const replies = messages.filter((message) => message.role === "AI" && message.hasEdits);
  const replyTo = (at: Date) => replies.find((message) => Math.abs(message.createdAt.getTime() - at.getTime()) <= SAME_CHANGE_MS);

  const changes: HistoryEntry[] = groups.map((group) => {
    const [head] = group;
    const reply = head.cause === "REFINED" ? replyTo(head.createdAt) : undefined;
    return {
      kind: "change",
      id: head.id,
      at: head.createdAt.toISOString(),
      text: changeText(head.cause, head.detail, group.map((version) => version.document), reply && firstParagraph(reply.text)),
      why: WHY[head.cause],
      versions: group.map(({ document, id, number, previousId }) => ({ document, id, number, previousId })),
      ...(reply && !reply.undone ? { messageId: reply.id } : {}),
    };
  });

  // Answers from Ask, with the question just before each.
  const answers: HistoryEntry[] = messages.flatMap((message, index) => {
    if (message.role !== "AI" || message.writtenWith !== ANSWER_QUESTION_VERSION) return [];
    const question = messages.slice(0, index).findLast((entry) => entry.role === "USER");
    return [{ kind: "answer", id: message.id, at: message.createdAt.toISOString(), question: question?.text ?? "", text: message.text }];
  });

  return [...changes, ...answers].sort((a, b) => b.at.localeCompare(a.at));
}
