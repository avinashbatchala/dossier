import "server-only";

import type { ApplicationStatus, EmailDirection, ReplyKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { questionsSchema } from "./sync";

// What the inbox and an application's Conversation tab show (E15-3).

export type EmailView = {
  id: string;
  threadId: string;
  direction: EmailDirection;
  fromName: string;
  fromAddress: string;
  subject: string;
  body: string;
  sentAt: Date;
  kind: ReplyKind | null;
  summary: string;
  questions: string[];
  suggestedStatus: ApplicationStatus | null;
  confirmedAt: Date | null;
  replyDraft: string;
  replyGaps: string[];
  handled: boolean;
  read: boolean;
  application: { id: string; company: string; role: string; status: ApplicationStatus } | null;
};

const SELECT = {
  id: true,
  threadId: true,
  direction: true,
  fromName: true,
  fromAddress: true,
  subject: true,
  body: true,
  sentAt: true,
  kind: true,
  summary: true,
  questions: true,
  suggestedStatus: true,
  confirmedAt: true,
  replyDraft: true,
  replyGaps: true,
  handledAt: true,
  classifiedWith: true,
  application: { select: { id: true, company: true, role: true, title: true, status: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.emailMessage.findFirstOrThrow<{ select: typeof SELECT }>>>;

const list = (value: unknown) => {
  const parsed = questionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};

function view({ handledAt, classifiedWith, application, questions, replyGaps, ...row }: Row): EmailView {
  return {
    ...row,
    questions: list(questions),
    replyGaps: list(replyGaps),
    handled: handledAt !== null,
    read: classifiedWith !== null,
    application: application
      ? { id: application.id, company: application.company, role: application.role || application.title, status: application.status }
      : null,
  };
}

/** An application's mail, oldest first. */
export async function loadConversation(applicationId: string): Promise<EmailView[]> {
  const rows = await prisma.emailMessage.findMany({ where: { applicationId, dismissedAt: null }, orderBy: { sentAt: "asc" }, select: SELECT });
  return rows.map(view);
}

export type Inbox = {
  /** Linked replies still waiting for an answer, newest first. */
  waiting: EmailView[];
  /** Mail not linked to an application yet. */
  unmatched: EmailView[];
  /** The latest replies that need nothing, for the record. */
  updates: EmailView[];
};

export async function loadInbox(): Promise<Inbox> {
  const [waiting, unmatched, updates] = await Promise.all([
    prisma.emailMessage.findMany({
      where: { direction: "INCOMING", applicationId: { not: null }, handledAt: null, dismissedAt: null },
      orderBy: { sentAt: "desc" },
      select: SELECT,
    }),
    prisma.emailMessage.findMany({
      where: { direction: "INCOMING", applicationId: null, dismissedAt: null },
      orderBy: { sentAt: "desc" },
      take: 50,
      select: SELECT,
    }),
    prisma.emailMessage.findMany({
      where: { direction: "INCOMING", applicationId: { not: null }, handledAt: { not: null }, dismissedAt: null },
      orderBy: { sentAt: "desc" },
      take: 20,
      select: SELECT,
    }),
  ]);
  return { waiting: waiting.map(view), unmatched: unmatched.map(view), updates: updates.map(view) };
}

/** How many replies wait for an answer or a link: the sidebar's count. */
export async function inboxCount(): Promise<number> {
  return prisma.emailMessage.count({ where: { direction: "INCOMING", handledAt: null, dismissedAt: null } });
}

/** Per application: replies waiting for an answer, for the dashboard. */
export async function waitingByApplication(): Promise<Map<string, { count: number; summary: string }>> {
  const rows = await prisma.emailMessage.findMany({
    where: { direction: "INCOMING", applicationId: { not: null }, handledAt: null, dismissedAt: null },
    orderBy: { sentAt: "desc" },
    select: { applicationId: true, summary: true, fromName: true },
  });
  const map = new Map<string, { count: number; summary: string }>();
  for (const row of rows) {
    const entry = map.get(row.applicationId!);
    if (entry) entry.count++;
    else map.set(row.applicationId!, { count: 1, summary: row.summary || `${row.fromName || "They"} wrote back.` });
  }
  return map;
}
