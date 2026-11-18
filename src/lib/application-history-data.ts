import "server-only";

import { editsSchema } from "@/lib/application-data";
import { historyFeed, type HistoryEntry } from "@/lib/application-history";
import { prisma } from "@/lib/prisma";

/** An application's history (E30-11): its documents' versions and the questions answered, newest first. */
export async function loadHistory(applicationId: string, messages: readonly { id: string; role: "USER" | "AI"; text: string; edits: unknown; writtenWith: string | null; createdAt: Date; undone: boolean }[]): Promise<HistoryEntry[]> {
  const versions = await prisma.documentVersion.findMany({
    where: { document: { applicationId } },
    select: { id: true, cause: true, detail: true, createdAt: true, document: { select: { kind: true } } },
  });
  return historyFeed({
    versions: versions.map(({ document, ...version }) => ({ ...version, document: document.kind })),
    messages: messages.map(({ edits, ...message }) => {
      const parsed = editsSchema.safeParse(edits);
      return { ...message, hasEdits: parsed.success && parsed.data.length > 0 };
    }),
  });
}
