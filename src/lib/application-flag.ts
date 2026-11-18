import { ApplicationStatus, type SentVia } from "@/generated/prisma/enums";
import { daysBetween, daysUntilCalendarDate, formatDateTime, formatDay, formatShortDay, formatTime } from "@/lib/dates";

// The one line that says what an application needs next (E27-2): on board
// cards, list rows, the application's header and the dashboard's Needs you,
// so they always say the same thing.

const DAY_MS = 86_400_000;

/** Within this many days, a flag is drawn in the warning colour. */
export const FLAG_SOON_DAYS = 7;

export type FlagApplication = {
  status: ApplicationStatus;
  /** Apply by: a calendar date at UTC midnight. */
  deadline: Date | null;
  sentAt: Date | null;
  /** When its status last changed; null when it never did. */
  lastStatusChange: Date | null;
  updatedAt: Date;
  /** Its latest email, either way (E29-7): a reply in, or a follow-up out, restarts "Quiet for". */
  lastContactAt?: Date | null;
  /** The next interview, while in Interview (E9-9). */
  nextInterviewAt: Date | null;
  /** Which round that interview is, once rounds are kept (E30-6). */
  round?: number | null;
  /** Employer replies waiting for an answer (E15-3). */
  waitingReplies?: number;
  /** Decide by, once offers are kept (E30-7): a calendar date at UTC midnight. */
  decideBy?: Date | null;
};

export type ApplicationFlag = {
  kind: "reply" | "apply-by" | "sent" | "quiet" | "interview" | "decide-by";
  /** "Apply by Thu 19 Nov · 3 days", "Quiet for 14 days", "A reply is waiting". */
  text: string;
  /** When it falls due; null for a reply, which is due now. */
  due: Date | null;
  /** Due within a week, overdue, or waiting on the user: drawn in the warning colour. */
  soon: boolean;
};

/** A flag's text mid-sentence: "apply by Thu 1 Oct · 3 days", "tomorrow, 09:30"; a day's name keeps its capital. */
export const flagInLine = (text: string) => (/^(Apply|Quiet|Today|Tomorrow|Decide|Sent|Interview|A reply)\b/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

type QuietFields = Pick<FlagApplication, "lastStatusChange" | "sentAt" | "updatedAt" | "lastContactAt">;

/** The latest contact either way: its latest email, or "I sent it" outside Gmail (E30-8). */
export const latestContact = (...dates: (Date | null | undefined)[]): Date | null =>
  dates.reduce<Date | null>((latest, date) => (date && (!latest || date > latest) ? date : latest), null);

/**
 * Since when an application has been quiet: its last status change, else
 * when it was sent, else its last edit; or its latest email, either way,
 * when that's later (E29-7).
 */
export function quietSince(application: QuietFields): Date {
  const since = application.lastStatusChange ?? application.sentAt ?? application.updatedAt;
  return application.lastContactAt && application.lastContactAt > since ? application.lastContactAt : since;
}

/** Days since an application was last heard of (see quietSince). */
export function daysQuiet(application: QuietFields, now: Date): number {
  return Math.floor((now.getTime() - quietSince(application).getTime()) / DAY_MS);
}

/** How it went out (E29-7), for a list's Sent column: "With Gmail"; empty when not said. */
export const SENT_WAY: Record<SentVia, string> = {
  GMAIL: "With Gmail",
  EMAIL: "By email",
  PORTAL: "On their site",
  OTHER: "Another way",
};

/** "Sent 2 Nov by Gmail", "Sent 2 Nov by email", "Sent 2 Nov": the date in the user's time zone. */
export function sentLine(sentAt: Date, sentVia: SentVia | null, { now, timeZone }: { now: Date; timeZone?: string }): string {
  const day = formatShortDay(sentAt, timeZone, now);
  const way = sentVia === "GMAIL" ? " by Gmail" : sentVia === "EMAIL" ? " by email" : sentVia === "PORTAL" ? " on their site" : "";
  return `Sent ${day}${way}`;
}

/** "today", "tomorrow", "3 days", "yesterday", "2 days ago". */
function inDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `${days} days` : `${-days} days ago`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What the application needs next, or null when there's nothing to say:
 * a waiting reply first, then by status. Closed applications have none.
 * Dates are in the user's time zone; calendar dates (Apply by, Decide by)
 * are the same day everywhere.
 */
export function applicationFlag(
  application: FlagApplication,
  { now, quietDays, timeZone }: { now: Date; quietDays: number; timeZone?: string },
): ApplicationFlag | null {
  const { status } = application;
  const open = status === ApplicationStatus.SENT || status === ApplicationStatus.SCREENING || status === ApplicationStatus.INTERVIEW || status === ApplicationStatus.OFFER;

  const waiting = application.waitingReplies ?? 0;
  if (open && waiting > 0) {
    return { kind: "reply", text: waiting === 1 ? "A reply is waiting" : `${waiting} replies are waiting`, due: null, soon: true };
  }

  if (status === ApplicationStatus.DRAFT) {
    if (!application.deadline) return null;
    const days = daysUntilCalendarDate(application.deadline, now, timeZone);
    const day = formatDay(application.deadline, "UTC", now);
    return { kind: "apply-by", text: `Apply by ${day} · ${days < 0 ? "passed" : inDays(days)}`, due: application.deadline, soon: days <= FLAG_SOON_DAYS };
  }

  if (status === ApplicationStatus.SENT || status === ApplicationStatus.SCREENING) {
    const days = daysQuiet(application, now);
    const since = quietSince(application);
    if (days >= quietDays) return { kind: "quiet", text: `Quiet for ${plural(days, "day")}`, due: new Date(since.getTime() + quietDays * DAY_MS), soon: true };
    if (status === ApplicationStatus.SCREENING || !application.sentAt) return null;
    const ago = daysBetween(application.sentAt, now, timeZone);
    return { kind: "sent", text: ago === 0 ? "Sent today" : ago === 1 ? "Sent yesterday" : `Sent ${ago} days ago`, due: null, soon: false };
  }

  if (status === ApplicationStatus.INTERVIEW) {
    const at = application.nextInterviewAt;
    if (!at) return null;
    const round = application.round ? ` · round ${application.round}` : "";
    if (at.getTime() < now.getTime()) return { kind: "interview", text: `Interview was ${formatDay(at, timeZone, now)}`, due: at, soon: true };
    const days = daysBetween(now, at, timeZone);
    const when = days === 0 ? `Today, ${formatTime(at, timeZone)}` : days === 1 ? `Tomorrow, ${formatTime(at, timeZone)}` : formatDateTime(at, timeZone, now);
    return { kind: "interview", text: `${when}${round}`, due: at, soon: days <= FLAG_SOON_DAYS };
  }

  if (status === ApplicationStatus.OFFER) {
    if (!application.decideBy) return null;
    const days = daysUntilCalendarDate(application.decideBy, now, timeZone);
    return { kind: "decide-by", text: `Decide by ${formatDay(application.decideBy, "UTC", now)}`, due: application.decideBy, soon: days <= FLAG_SOON_DAYS };
  }

  return null;
}
