import { ApplicationStatus, FunnelStage } from "@/generated/prisma/enums";
import { applicationFlag, daysQuiet, flagInLine } from "@/lib/application-flag";
import { daysBetween, formatDay } from "@/lib/dates";
import { FUNNEL_STAGES, STATUSES } from "@/lib/status";

// Every dashboard figure (E9-6, PRD §6.7 and §8), worked out on the server
// from the applications, so the dashboard only draws them.

/** What the dashboard needs to know about an application. */
export type DashboardApplication = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  furthestStage: FunnelStage | null;
  archived: boolean;
  /** Calendar date at UTC midnight. */
  deadline: Date | null;
  /** When its status last changed; null when it never did. */
  lastStatusChange: Date | null;
  sentAt: Date | null;
  /** The next interview, while in Interview (E9-9). */
  nextInterviewAt: Date | null;
  /** Its latest email, either way (E29-7), or "I sent it" (E30-8); null without one. */
  lastContactAt?: Date | null;
  /** The offer's Decide by (E30-7), at UTC midnight. */
  decideBy?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Where an application that went no further than a stage is now: still
 * open, rejected, declined, or archived while it was still open.
 */
export type FunnelOutcome = "open" | "rejected" | "declined" | "archived";
/** The outcomes, in the order the funnel draws them. */
export const FUNNEL_OUTCOMES: readonly FunnelOutcome[] = ["open", "rejected", "declined", "archived"];

export type FunnelStep = {
  stage: FunnelStage;
  count: number;
  /** Percent of the previous stage, rounded; null for Sent or when the previous stage is empty. */
  conversion: number | null;
  /**
   * The applications that got this far and no further, by outcome. Accepted
   * is the end of the funnel, so it has none: they all count as accepted.
   */
  stopped: Record<FunnelOutcome, number>;
};

/** One thing that needs the user (E28-4), as a row of Needs you. */
export type NeedsYouItem = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  /** What it's about: "Still a draft.", "Interview.", "A reply is waiting: …". */
  reason: string;
  /** When it's due, as the row says it: "apply by Thu 1 Oct", "tomorrow at 09:30", "quiet for 14 days"; null when it has no date. */
  due: string | null;
  /** Due this week or overdue: drawn in the warning colour, and counted in "N things need you this week". */
  soon: boolean;
  /** The row's button. */
  action: "Answer" | "Review offer" | "Prepare" | "Finish draft" | "Follow up" | "Update" | "Add the date";
  /** Where the button opens, when not the application's first tab. */
  tab?: "conversation";
};

/** One week of the activity chart (E9-8): applications started and sent in it. */
export type WeekActivity = {
  /** The Monday the week starts on, in the server's time zone. */
  start: Date;
  created: number;
  sent: number;
};

/** The dashboard's time filter (E9-8, DSH-7). */
export const DASHBOARD_PERIODS = [
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]["value"];

/** "30d" from `?period=`, or null for anything else. */
export function periodFromParam(value: unknown): DashboardPeriod | null {
  return DASHBOARD_PERIODS.find((period) => period.value === value)?.value ?? null;
}

/** The activity chart shows at most a year of weeks. */
const MAX_WEEKS = 52;

export type DashboardFigures = {
  /** Every application, whatever the period: none at all means the welcome. */
  total: number;
  /** How many applications are in each status now, all eight. */
  byStatus: Record<ApplicationStatus, number>;
  /**
   * Sent → Accepted by the furthest stage reached, so closed applications
   * count where they got to (DSH-3), and how the ones that stopped ended.
   */
  funnel: FunnelStep[];
  sent: number;
  heardBack: number;
  /** Heard back ÷ sent, rounded; null before anything was sent. */
  heardBackPercent: number | null;
  reachedInterview: number;
  /** Needs you (E28-4): due this week first, then undated; always about now, whatever the period. */
  needsYou: NeedsYouItem[];
  /** Sent and heard back over all time, for the header, which the period doesn't scope (E28-1). */
  overall: { sent: number; heardBack: number };
  /** The period's applications by the week they were started and sent, oldest first. */
  weeks: WeekActivity[];
};

/** A Sent or Screening application quiet for this many days deserves a follow-up, unless the settings say otherwise (E9-9). */
export const DEFAULT_QUIET_DAYS = 7;
/** The choices for that threshold. */
export const QUIET_DAYS_CHOICES = [3, 5, 7, 10, 14, 21, 30] as const;

export type DashboardOptions = {
  period?: DashboardPeriod;
  /** Days without news before Needs you suggests a follow-up. */
  quietDays?: number;
  /** Per application, replies from Gmail waiting for an answer (E15-3). */
  replies?: ReadonlyMap<string, { count: number; summary: string }>;
  /** The user's time zone, for interview dates; the server's when not given. */
  timeZone?: string;
};

const DAY_MS = 86_400_000;
const rank = (stage: FunnelStage | null) => (stage === null ? -1 : FUNNEL_STAGES.indexOf(stage));

/** A closed status says how it ended; an open one archived means it was let go (decided 16 October 2026). */
function outcome({ status, archived }: DashboardApplication): FunnelOutcome {
  if (status === ApplicationStatus.REJECTED) return "rejected";
  if (status === ApplicationStatus.DECLINED) return "declined";
  return archived ? "archived" : "open";
}

/**
 * Counts and Needs you (decided 28 September 2026): archived
 * applications count in the funnel and the status breakdown, but never
 * need you. With a period (E9-8, decided 29 September 2026), the funnel
 * and the breakdown count the applications created in it.
 */
export function dashboardFigures(
  all: readonly DashboardApplication[],
  now = new Date(),
  { period = "all", quietDays = DEFAULT_QUIET_DAYS, timeZone, replies }: DashboardOptions = {},
): DashboardFigures {
  const days = DASHBOARD_PERIODS.find((entry) => entry.value === period)?.days ?? null;
  const since = days === null ? null : now.getTime() - days * DAY_MS;
  const applications = since === null ? all : all.filter((application) => application.createdAt.getTime() >= since);

  const byStatus = Object.fromEntries(STATUSES.map(({ value }) => [value, 0])) as Record<ApplicationStatus, number>;
  for (const application of applications) byStatus[application.status] += 1;

  const reached = (stage: FunnelStage) => applications.filter((application) => rank(application.furthestStage) >= rank(stage)).length;
  const funnel = FUNNEL_STAGES.map((stage, index): FunnelStep => {
    const count = reached(stage);
    const previous = index > 0 ? reached(FUNNEL_STAGES[index - 1]) : 0;
    const stopped = Object.fromEntries(FUNNEL_OUTCOMES.map((key) => [key, 0])) as Record<FunnelOutcome, number>;
    if (index < FUNNEL_STAGES.length - 1) {
      for (const application of applications) if (application.furthestStage === stage) stopped[outcome(application)] += 1;
    }
    return { stage, count, conversion: index > 0 && previous > 0 ? Math.round((count / previous) * 100) : null, stopped };
  });
  const sent = reached(FunnelStage.SENT);
  const heardBack = reached(FunnelStage.SCREENING);

  return {
    total: all.length,
    byStatus,
    funnel,
    sent,
    heardBack,
    heardBackPercent: sent > 0 ? Math.round((heardBack / sent) * 100) : null,
    reachedInterview: reached(FunnelStage.INTERVIEW),
    needsYou: needsYou(all.filter((application) => !application.archived), now, { quietDays, timeZone, replies }),
    overall: {
      sent: all.filter((application) => rank(application.furthestStage) >= rank(FunnelStage.SENT)).length,
      heardBack: all.filter((application) => rank(application.furthestStage) >= rank(FunnelStage.SCREENING)).length,
    },
    weeks: weeklyActivity(applications, now, since),
  };
}

/** The Monday of a date's week, at midnight in the server's time zone. */
function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/**
 * The period's applications (the same ones the funnel counts) by the week
 * they were created and the week they were sent, from the week the period
 * starts (or the first application's, for all time) to this one, at most a
 * year.
 */
function weeklyActivity(applications: readonly DashboardApplication[], now: Date, since: number | null): WeekActivity[] {
  if (applications.length === 0) return [];
  const first = since ?? Math.min(...applications.map((application) => application.createdAt.getTime()));
  const weeks: WeekActivity[] = [];
  for (let start = weekStart(new Date(first)); start <= now; start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) {
    weeks.push({ start, created: 0, sent: 0 });
  }
  const recent = weeks.slice(-MAX_WEEKS);
  const indexOf = (date: Date) => recent.findIndex((week, index) => date >= week.start && (index === recent.length - 1 || date < recent[index + 1].start));
  for (const application of applications) {
    const created = indexOf(application.createdAt);
    if (created >= 0) recent[created].created += 1;
    const sent = application.sentAt ? indexOf(application.sentAt) : -1;
    if (sent >= 0) recent[sent].sent += 1;
  }
  return recent;
}

/** Days since an application last changed, or was sent: the same count as its flag's "Quiet for" (E27-2). */
const silence = (application: DashboardApplication, now: Date) => daysQuiet(application, now);

/**
 * Sent or in Screening with no news for `quietDays` or more, the longest
 * silence first: the dashboard's follow-up suggestions, and the "A follow-up
 * is due" notification (E26-7).
 */
export function quietApplications(applications: readonly DashboardApplication[], now: Date, quietDays: number): { application: DashboardApplication; days: number }[] {
  return applications
    .filter((application) => (application.status === ApplicationStatus.SENT || application.status === ApplicationStatus.SCREENING) && silence(application, now) >= quietDays)
    .map((application) => ({ application, days: silence(application, now) }))
    .sort((a, b) => b.days - a.days);
}

/** Undated items, in this order after the dated ones. */
const UNDATED_ORDER: ApplicationStatus[] = [ApplicationStatus.OFFER, ApplicationStatus.INTERVIEW, ApplicationStatus.DRAFT];

/**
 * "Needs you" (E28-4, decided 16 November 2026): first what's due this week
 * or overdue, soonest first, with replies waiting at the very top; then what
 * still needs the user but has no date. One item per application. What's
 * due when, and whether it's this week, comes from the application's flag
 * (E27-2), as on the board; things due later than a week wait until they're
 * close.
 */
function needsYou(
  applications: readonly DashboardApplication[],
  now: Date,
  { quietDays, timeZone, replies }: { quietDays: number; timeZone?: string; replies?: DashboardOptions["replies"] },
): NeedsYouItem[] {
  const dated: { at: number; item: NeedsYouItem }[] = [];
  const undated: { updated: number; item: NeedsYouItem }[] = [];

  for (const application of applications) {
    const { id, company, role, status } = application;
    const base = { id, company, role, status };
    const waiting = replies?.get(id);
    const flag = applicationFlag({ ...application, waitingReplies: waiting?.count ?? 0 }, { now, quietDays, timeZone });
    const due = (item: Omit<NeedsYouItem, keyof typeof base | "soon" | "due">, text: string | null = flag ? flagInLine(flag.text) : null) =>
      dated.push({ at: flag?.due?.getTime() ?? -Infinity, item: { ...base, ...item, due: text, soon: true } });
    const later = (item: Omit<NeedsYouItem, keyof typeof base | "soon" | "due">) =>
      undated.push({ updated: application.updatedAt.getTime(), item: { ...base, ...item, due: null, soon: false } });

    if (flag?.kind === "reply" && waiting) {
      // A reply waiting for an answer comes first, in place of the application's other item (E15-3).
      const reason = waiting.count === 1 ? `A reply is waiting: ${waiting.summary}` : `${waiting.count} replies are waiting. ${waiting.summary}`;
      due({ reason, action: "Answer", tab: "conversation" }, null);
      continue;
    }
    // Due later than a week: not yet.
    if (flag && !flag.soon) continue;

    if (status === ApplicationStatus.OFFER) {
      if (flag?.kind === "decide-by") due({ reason: "An offer is waiting on your decision.", action: "Review offer" });
      else later({ reason: "An offer is waiting on your decision.", action: "Review offer" });
    } else if (status === ApplicationStatus.DRAFT) {
      if (flag?.kind === "apply-by") due({ reason: "Still a draft.", action: "Finish draft" });
      else later({ reason: "Still a draft. Ready when you are.", action: "Finish draft" });
    } else if (flag?.kind === "quiet") {
      const reason =
        status === ApplicationStatus.SENT && application.sentAt ? `Sent ${formatDay(application.sentAt, timeZone, now)}, no reply.` : "No news since it moved to screening.";
      due({ reason, action: "Follow up" });
    } else if (status === ApplicationStatus.INTERVIEW) {
      const at = application.nextInterviewAt;
      if (!at) later({ reason: "You're interviewing. Add the next interview's date.", action: "Add the date" });
      else if (at.getTime() < now.getTime()) {
        const when = daysBetween(at, now, timeZone) === 0 ? "earlier today" : `on ${formatDay(at, timeZone, now)}`;
        due({ reason: `Your interview was ${when}. How did it go?`, action: "Update" }, null);
      } else due({ reason: "Interview.", action: "Prepare" });
    }
  }

  return [
    ...dated.sort((a, b) => a.at - b.at).map((entry) => entry.item),
    ...undated.sort((a, b) => UNDATED_ORDER.indexOf(a.item.status) - UNDATED_ORDER.indexOf(b.item.status) || b.updated - a.updated).map((entry) => entry.item),
  ];
}
