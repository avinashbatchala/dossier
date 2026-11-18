import "server-only";

import { DocumentKind, EmailDirection, type ApplicationStatus, type FunnelStage } from "@/generated/prisma/enums";
import { matchSchema, matchScore } from "@/lib/application-data";
import { applicationFlag, daysQuiet, latestContact, SENT_WAY, type ApplicationFlag } from "@/lib/application-flag";
import { sortRows, updatedAgo, type Sort } from "@/lib/applications-list";
import { formatCalendarDate, formatDateTime, formatShortDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";

/** An application as the board and the list show it (E9-2, E9-3, E29). */
export type ApplicationRow = {
  id: string;
  company: string;
  /** The role, or the title when there's no role. */
  role: string;
  location: string;
  mode: string;
  status: ApplicationStatus;
  /** How far it got (DSH-3), for the lanes' conversions. */
  furthestStage: FunnelStage | null;
  archived: boolean;
  /** "Apply by", e.g. "3 Oct 2026". */
  deadline: string | null;
  /** Requirements covered, out of all (U1), or null when not matched. */
  match: { hit: number; total: number } | null;
  /** When it was sent, e.g. "18 Aug", in the user's time zone; null while never sent. */
  sent: string | null;
  /** How, e.g. "With Gmail"; empty when not said (E29-7). */
  sentWay: string;
  /** Days without news, while Sent or in Screening (E29-7). */
  quietDays: number | null;
  /** Which tailored documents it has. */
  docs: { resume: boolean; letter: boolean };
  /** The employer's latest mail: when, and from whom. */
  lastReply: { on: string; from: string } | null;
  /** Replies waiting for an answer (E15-3). */
  waiting: number;
  /** The next interview, "Thu 19 Nov, 14:00", while in Interview. */
  nextInterview: string | null;
  /** Which round that is, once rounds are kept (E30-6). */
  round: number | null;
  /** The posted salary, until an offer's is kept (E30-7). */
  salary: string;
  /** What it needs next (E27-2), as cards and rows show it. */
  flag: ApplicationFlag | null;
  /** "Today", "3 days ago"… */
  updated: string;
  /** For the board, which shows the latest update first among cards without a place. */
  updatedAt: number;
  /** Its place in its board column; null until reordered (public issue 60). */
  boardSort: number | null;
};

export type RowOptions = {
  /** The user's time zone, for dates; the server's when not given. */
  timeZone?: string;
  /** Days without news before a follow-up is due (E9-9); 7 unless set. */
  quietDays?: number;
  /** Replies waiting per application (E15-3). */
  replies?: ReadonlyMap<string, { count: number }>;
  now?: Date;
};

/** Every application, archived ones only when asked for, sorted for the list; agent drafts once approved (#195). */
export async function loadApplicationRows({ archived, sort }: { archived: boolean; sort: Sort }, { timeZone, quietDays = 7, replies, now = new Date() }: RowOptions = {}) {
  const applications = await prisma.application.findMany({
    where: { awaitingReview: false, ...(archived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      title: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      salary: true,
      status: true,
      furthestStage: true,
      archivedAt: true,
      deadline: true,
      match: true,
      sentAt: true,
      sentVia: true,
      nextInterviewAt: true,
      contactedAt: true,
      offer: { select: { decideBy: true, salary: true } },
      updatedAt: true,
      boardSort: true,
      documents: { select: { kind: true } },
      events: { select: { at: true }, orderBy: { at: "desc" }, take: 1 },
      emails: { where: { dismissedAt: null }, select: { sentAt: true, direction: true, fromName: true, fromAddress: true }, orderBy: { sentAt: "desc" } },
    },
  });
  const rows = applications.map((application) => {
    const match = matchSchema.safeParse(application.match);
    const lastIncoming = application.emails.find((email) => email.direction === EmailDirection.INCOMING);
    const waiting = replies?.get(application.id)?.count ?? 0;
    const flagFields = {
      status: application.status,
      deadline: application.deadline,
      sentAt: application.sentAt,
      lastStatusChange: application.events[0]?.at ?? null,
      updatedAt: application.updatedAt,
      nextInterviewAt: application.nextInterviewAt,
      lastContactAt: latestContact(application.emails[0]?.sentAt, application.contactedAt),
      waitingReplies: waiting,
      decideBy: application.offer?.decideBy ?? null,
    };
    const quiet = application.status === "SENT" || application.status === "SCREENING";
    return {
      id: application.id,
      company: application.company.trim(),
      role: application.role.trim() || application.title.trim() || "Untitled application",
      location: application.location.trim(),
      mode: application.mode.trim(),
      status: application.status,
      furthestStage: application.furthestStage,
      archived: application.archivedAt !== null,
      deadline: application.deadline ? formatCalendarDate(application.deadline) : null,
      match: match.success && match.data.items.length > 0 ? matchScore(match.data) : null,
      sentAt: application.sentAt,
      sentWay: application.sentVia ? SENT_WAY[application.sentVia] : "",
      quietDays: quiet ? daysQuiet(flagFields, now) : null,
      docs: {
        resume: application.documents.some((document) => document.kind === DocumentKind.RESUME),
        letter: application.documents.some((document) => document.kind === DocumentKind.COVER_LETTER),
      },
      lastReply: lastIncoming ? { on: formatShortDay(lastIncoming.sentAt, timeZone, now), from: lastIncoming.fromName.trim() || lastIncoming.fromAddress } : null,
      waiting,
      nextInterview: application.status === "INTERVIEW" && application.nextInterviewAt ? formatDateTime(application.nextInterviewAt, timeZone, now) : null,
      round: null,
      // The offer's, once there is one (E30-7), else the posted one.
      salary: application.offer?.salary.trim() || application.salary.trim(),
      flag: applicationFlag(flagFields, { now, quietDays, timeZone }),
      updatedAt: application.updatedAt,
      boardSort: application.boardSort,
    };
  });
  return sortRows(rows, sort).map(({ sentAt, updatedAt, ...row }): ApplicationRow => ({
    ...row,
    sent: sentAt ? formatShortDay(sentAt, timeZone, now) : null,
    updated: updatedAgo(updatedAt, now),
    updatedAt: updatedAt.getTime(),
  }));
}
