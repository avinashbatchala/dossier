import "server-only";

import { fullText } from "@/lib/job-search/find";
import type { FoundPosting } from "@/lib/job-search/search";
import { storePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";

import { connectorSince } from "./oauth";

// Handing work to Claude chat (#221): with the Claude connector on and no AI
// model of Dossier's own, the buttons that need one open a new claude.ai chat
// instead, with a short prompt that names the posting by an id the connector
// can read. The chat runs on the user's own Claude plan, in Anthropic's own
// app; Dossier never sees or keeps anything of the Claude account.

/** A pasted posting waits this long for Claude to read it. */
export const PASTE_DAYS = 14;

export type Handoff = "write" | "score";

/** A new claude.ai chat that starts with `prompt`. Prompts stay short: links over about 2,000 characters break. */
export const claudeChatUrl = (prompt: string) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;

/** Whether the buttons hand work to Claude: the connector is on and Dossier has no usable model of its own. */
export async function handsOffToClaude(aiUsable: boolean): Promise<boolean> {
  return !aiUsable && (await connectorSince()) !== null;
}

const describe = (title: string, company: string) =>
  [title, company]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" at ");

function promptFor(kind: Handoff, ref: string, about: string): string {
  const what = about ? `the job posting ${ref} (${about})` : `the job posting ${ref}`;
  if (kind === "score") {
    return (
      `Using my Dossier connector: score how well ${what} fits my profile. ` +
      "Read it with get_posting and my profile with get_profile, give a score from 0 to 100 with the reasons and any red flags, and save it with save_job_scores."
    );
  }
  return (
    `Using my Dossier connector: write a tailored resume and cover letter for ${what}. ` +
    "Read it with get_posting and my profile with get_profile. Use only facts from my profile and tell me about any gaps. " +
    "Show me a short summary and the fit, then save it with save_application."
  );
}

/** For a posting from Find jobs: keeps it with its whole text, and gives the chat to open. */
export async function handOffFoundPosting(posting: FoundPosting, kind: Handoff): Promise<string> {
  const text = posting.complete ? posting.description : await fullText(posting);
  const stored = await storePosting(text ? { ...posting, description: text, complete: true } : posting);
  return claudeChatUrl(promptFor(kind, `with posting_id "${stored.id}"`, describe(posting.title, posting.company)));
}

/** For a posting pasted into New application: keeps its text for Claude to read, and gives the chat to open. */
export async function handOffPastedPosting({ text, url }: { text: string; url: string }, now = new Date()): Promise<string> {
  const paste = await prisma.claudePaste.create({
    data: { text, url, expiresAt: new Date(now.getTime() + PASTE_DAYS * 24 * 60 * 60 * 1000) },
    select: { id: true },
  });
  return claudeChatUrl(promptFor("write", `with paste_id "${paste.id}"`, ""));
}

/** A pasted posting kept for Claude, or null once it's gone or expired. */
export async function readPastedPosting(id: string, now = new Date()): Promise<{ text: string; url: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const paste = await prisma.claudePaste.findUnique({ where: { id }, select: { text: true, url: true, expiresAt: true } });
  return paste && paste.expiresAt > now ? { text: paste.text, url: paste.url } : null;
}
