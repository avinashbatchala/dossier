import { ApplicationStatus, FunnelStage } from "@/generated/prisma/enums";
import { FUNNEL_STAGES, STATUSES, statusInfo } from "@/lib/status";

// The Applications screen (E9, E29): its view, status, search and sorting,
// kept in the URL (?status=&view=&q=&sort=&archived=) so links can be shared
// and back and forward work.

/** Board, or the list (E29-1: "list" replaced "table", which old links still say). */
export const VIEWS = ["board", "list"] as const;
export type View = (typeof VIEWS)[number];

/** Which statuses count as in progress, and which as closed. */
export function statusesIn(group: "all" | "active" | "closed"): ApplicationStatus[] {
  return STATUSES.filter((status) => group === "all" || (group === "active" ? status.group === "in-progress" : status.group === "closed")).map(
    (status) => status.value,
  );
}

/**
 * One status from the sidebar or a tab (E27-4, E29-1), or "closed" for
 * Accepted, Rejected and Declined together (SH1). Written in lower case in
 * the URL: `status=sent`.
 */
export type StatusParam = ApplicationStatus | "closed";

/** A `status=` value, or null when it's missing or unknown. */
export function parseStatusParam(value: string | undefined): StatusParam | null {
  const wanted = value?.toUpperCase();
  if (wanted === "CLOSED") return "closed";
  return STATUSES.find((status) => status.value === wanted)?.value ?? null;
}

/** How a status is written in the URL. */
export const statusParamValue = (status: StatusParam) => status.toLowerCase();

/** The list of a status: it opens as a list, unless Board was chosen there before (LB1). */
export const statusHref = (status: StatusParam) => `/applications?status=${statusParamValue(status)}`;

/** The statuses a list shows: the one from `status=`, the three closed ones, or all of them. */
export function statusesShown({ status }: { status?: StatusParam | null }): ApplicationStatus[] {
  if (status === "closed") return statusesIn("closed");
  return status ? [status] : statusesIn("all");
}

/** A status's name, with Closed for the three closed ones. */
export const statusParamLabel = (status: StatusParam) => (status === "closed" ? "Closed" : statusInfo(status).label);

/**
 * The statuses under Applications in the sidebar (E27-4), and the status
 * tabs above the list (E29-1): the five in progress, then Closed for the
 * other three, each with its count and link. Archived applications aren't
 * counted.
 */
export function sidebarStatuses(counts: ReadonlyMap<ApplicationStatus, number>): { status: StatusParam; label: string; color: string; count: number; href: string }[] {
  const count = (statuses: readonly ApplicationStatus[]) => statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);
  return [
    ...STATUSES.filter((status) => status.group === "in-progress").map(({ value, label, color }) => ({ status: value, label, color, count: count([value]), href: statusHref(value) })),
    { status: "closed" as const, label: "Closed", color: "var(--color-status-declined)", count: count(statusesIn("closed")), href: statusHref("closed") },
  ];
}

/** The table's sortable columns. */
export const SORT_KEYS = ["role", "status", "match", "location", "sent", "updated"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
/** A column and whether it's reversed from its natural order, which comes first. */
export type Sort = { key: SortKey; reversed: boolean };

/**
 * Each column's natural order, the one a first click gives: text A to Z,
 * statuses in pipeline order, and the best match or the latest date first.
 */
export const NATURAL_ORDER: Record<SortKey, "ascending" | "descending"> = {
  role: "ascending",
  status: "ascending",
  match: "descending",
  location: "ascending",
  sent: "descending",
  updated: "descending",
};

export const DEFAULT_SORT: Sort = { key: "updated", reversed: false };

export type ListParams = {
  view: View;
  /** One status, or the three closed ones (E27-4, E29-1); null shows all. Not remembered. */
  status: StatusParam | null;
  q: string;
  sort: Sort;
  archived: boolean;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The list's state from the URL, e.g. `sort=-match` for the match column reversed. */
export function parseListParams(params: Record<string, string | string[] | undefined>): Partial<ListParams> & { q: string } {
  // "table" is the list's old name, in old links and in settings (E29-1).
  const rawView = one(params.view) === "table" ? "list" : one(params.view);
  const view = VIEWS.find((entry) => entry === rawView);
  // `filter=closed` is how links said Closed before E29.
  const status = parseStatusParam(one(params.status)) ?? (one(params.filter) === "closed" ? "closed" : null);
  const rawSort = one(params.sort) ?? "";
  const key = SORT_KEYS.find((entry) => entry === rawSort.replace(/^-/, ""));
  return {
    ...(view ? { view } : {}),
    ...(status ? { status } : {}),
    ...(key ? { sort: { key, reversed: rawSort.startsWith("-") } } : {}),
    ...(one(params.archived) === "1" ? { archived: true } : {}),
    q: (one(params.q) ?? "").trim().slice(0, 200),
  };
}

/** A sort as it's written in the URL and in Settings: "updated", "-match". */
const sortParam = ({ key, reversed }: Sort) => `${reversed ? "-" : ""}${key}`;

/**
 * The list's state (LST-7, E29-1): what the URL says, then what was last
 * used, then the defaults. All applications open in the view last used; a
 * single status opens as a list, unless Board was chosen in that status
 * before (LB1). The search and "Show archived" aren't remembered.
 */
export function resolveListParams(
  url: Record<string, string | string[] | undefined>,
  remembered: { applicationsView: string; applicationsSort: string; applicationsBoardStatuses: readonly string[] },
): ListParams {
  const last = parseListParams({ view: remembered.applicationsView, sort: remembered.applicationsSort });
  const asked = parseListParams(url);
  const status = asked.status ?? null;
  const view = asked.view ?? (status ? (remembered.applicationsBoardStatuses.includes(statusParamValue(status)) ? "board" : "list") : (last.view ?? "board"));
  return { sort: DEFAULT_SORT, archived: false, ...last, ...asked, status, view };
}

/** The URL for a state; defaults are left out, so the plain page is `/applications`. A status always says its view. */
export function listHref({ view, status, q, sort, archived }: ListParams): string {
  const params = new URLSearchParams();
  if (status) params.set("status", statusParamValue(status));
  if (status || view !== "board") params.set("view", view);
  if (q) params.set("q", q);
  if (sort.key !== DEFAULT_SORT.key || sort.reversed) params.set("sort", sortParam(sort));
  if (archived) params.set("archived", "1");
  const query = params.toString();
  return query ? `/applications?${query}` : "/applications";
}

/** What the list needs to sort a row. */
export type Sortable = {
  role: string;
  company: string;
  status: ApplicationStatus;
  /** Requirements covered, out of all (e.g. 5/7), or null when not matched. */
  match: { hit: number; total: number } | null;
  location: string;
  sentAt: Date | null;
  updatedAt: Date;
};

const statusRank = (status: ApplicationStatus) => STATUSES.findIndex((entry) => entry.value === status);
const matchRatio = (match: Sortable["match"]) => (match && match.total > 0 ? match.hit / match.total : -1);
const text = (value: string) => value.trim().toLocaleLowerCase();

/**
 * Sorts rows for the table (LST-5). Rows that were never sent stay last
 * under Sent, whichever way it's sorted; ties go to the latest update.
 */
export function sortRows<T extends Sortable>(rows: readonly T[], { key, reversed }: Sort): T[] {
  const direction = (NATURAL_ORDER[key] === "ascending" ? 1 : -1) * (reversed ? -1 : 1);
  const compare = (a: T, b: T): number => {
    switch (key) {
      case "role":
        return text(a.role || a.company).localeCompare(text(b.role || b.company)) * direction;
      case "status":
        return (statusRank(a.status) - statusRank(b.status)) * direction;
      case "match":
        return (matchRatio(a.match) - matchRatio(b.match)) * direction;
      case "location":
        return text(a.location).localeCompare(text(b.location)) * direction;
      case "sent":
        if (!a.sentAt || !b.sentAt) return (a.sentAt ? 0 : 1) - (b.sentAt ? 0 : 1);
        return (a.sentAt.getTime() - b.sentAt.getTime()) * direction;
      case "updated":
        return (a.updatedAt.getTime() - b.updatedAt.getTime()) * direction;
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || b.updatedAt.getTime() - a.updatedAt.getTime());
}

/**
 * "9 applications: 2 waiting to hear back, 2 in conversation. Nice
 * momentum." (LST-1): waiting is Sent and Screening, in conversation is
 * Interview and Offer.
 */
export function listSummary(statuses: readonly ApplicationStatus[]): string {
  if (statuses.length === 0) return "No applications yet. Paste a job posting and I'll tailor your resume and cover letter to it.";
  const count = (...wanted: ApplicationStatus[]) => statuses.filter((status) => wanted.includes(status)).length;
  const waiting = count(ApplicationStatus.SENT, ApplicationStatus.SCREENING);
  const talking = count(ApplicationStatus.INTERVIEW, ApplicationStatus.OFFER);
  const total = `${statuses.length} ${statuses.length === 1 ? "application" : "applications"}`;
  return `${total}: ${waiting} waiting to hear back, ${talking} in conversation.${talking > 0 ? " Nice momentum." : ""}`;
}

/** What a lane's sub-line reads from a row (E29-3). */
export type LaneRow = SummaryRow & { furthestStage: FunnelStage | null };

/**
 * Each open lane's sub-line (E29-3): how far the ones that got there went
 * on ("71% heard back"), then what needs doing in it ("1 reply waiting").
 * Counted over every application that isn't archived, whatever the search.
 */
export function laneNotes(rows: readonly LaneRow[]): Partial<Record<ApplicationStatus, string>> {
  const reached = (stage: FunnelStage) => rows.filter((row) => row.furthestStage !== null && FUNNEL_STAGES.indexOf(row.furthestStage) >= FUNNEL_STAGES.indexOf(stage)).length;
  const percent = (stage: FunnelStage, of: FunnelStage) => (reached(of) > 0 ? `${Math.round((reached(stage) / reached(of)) * 100)}%` : null);
  const inLane = (status: ApplicationStatus) => rows.filter((row) => row.status === status);
  const join = (...parts: (string | null | false)[]) => parts.filter(Boolean).join(" · ");

  const due = inLane(ApplicationStatus.DRAFT).filter((row) => row.flag?.kind === "apply-by" && row.flag.soon).length;
  const quiet = inLane(ApplicationStatus.SENT).filter((row) => row.flag?.kind === "quiet").length;
  const waiting = inLane(ApplicationStatus.SCREENING).reduce((sum, row) => sum + row.waiting, 0);
  const heard = percent(FunnelStage.SCREENING, FunnelStage.SENT);
  const interviewed = percent(FunnelStage.INTERVIEW, FunnelStage.SCREENING);
  const offered = percent(FunnelStage.OFFER, FunnelStage.INTERVIEW);
  const [next] = inLane(ApplicationStatus.INTERVIEW)
    .filter((row) => row.flag?.kind === "interview" && row.flag.due && row.nextInterview)
    .sort((a, b) => a.flag!.due!.getTime() - b.flag!.due!.getTime());
  return {
    DRAFT: join(due > 0 && `${due} due this week`),
    SENT: join(quiet > 0 && `${quiet} quiet for a while`),
    SCREENING: join(heard && `${heard} heard back`, waiting > 0 && `${plural(waiting, "reply", "replies")} waiting`),
    INTERVIEW: join(interviewed && `${interviewed} of screening`, next && `Next: ${next.nextInterview}`),
    OFFER: join(offered && `${offered} of interview`),
  };
}

/** A row's or card's button (E29-2, E29-4): what doing the next thing means, and the tab it opens on. */
export type RowAction = {
  label: string;
  tab: "resume" | "email" | "conversation";
  /** The work the click starts on the application's page (U3): Prepare's checklist, or a follow-up's draft. */
  start?: "prepare" | "follow-up";
};

/**
 * What an application needs next, as a button: on a card, short ("Send",
 * "Follow up"), in a list and the application's header (E30-2), in full
 * ("Finish draft", "Draft a follow-up"). A waiting reply comes first. Null when nothing's to do: a recent send, or
 * a closed application. Drafting on the click comes with E30.
 */
export function rowAction(
  row: { status: ApplicationStatus; waiting: number; docs: { resume: boolean; letter: boolean }; flag: { kind: string } | null },
  place: "card" | "list" | "header",
): RowAction | null {
  const card = place === "card";
  if (row.waiting > 0 && row.status !== ApplicationStatus.DRAFT && statusInfo(row.status).group === "in-progress")
    return { label: place === "header" ? "Answer reply" : "Answer", tab: "conversation" };
  switch (row.status) {
    case ApplicationStatus.DRAFT:
      return row.docs.resume ? { label: card ? "Send" : "Review and send", tab: "email" } : { label: card ? "Finish" : "Finish draft", tab: "resume" };
    case ApplicationStatus.SENT:
    case ApplicationStatus.SCREENING:
      return row.flag?.kind === "quiet" ? { label: card ? "Follow up" : "Draft a follow-up", tab: "email", start: "follow-up" } : null;
    case ApplicationStatus.INTERVIEW:
      return { label: "Prepare", tab: "resume", start: "prepare" };
    case ApplicationStatus.OFFER:
      return { label: card ? "Review" : "Review offer", tab: "resume" };
    default:
      return null;
  }
}

/** Where a row's or card's button goes. */
export const actionHref = (id: string, action: RowAction) => {
  const query = new URLSearchParams({ ...(action.tab === "resume" ? {} : { tab: action.tab }), ...(action.start ? { start: action.start } : {}) }).toString();
  return `/applications/${id}${query ? `?${query}` : ""}`;
};

/** What a status's summary line reads from a row (E29-1). */
export type SummaryRow = {
  status: ApplicationStatus;
  company: string;
  role: string;
  quietDays: number | null;
  waiting: number;
  nextInterview: string | null;
  flag: { kind: string; soon: boolean; due: Date | null } | null;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The line under a status's title (E29-1): what the status holds and what
 * stands out in it. "2 waiting to hear back. Meridian Bank has been quiet
 * for 14 days."
 */
export function statusSummary(status: StatusParam, rows: readonly SummaryRow[]): string {
  const shown = statusesShown({ status });
  const of = rows.filter((row) => shown.includes(row.status));
  const name = (row: SummaryRow) => row.company || row.role;
  if (of.length === 0) return status === "closed" ? "Nothing closed yet." : `Nothing in ${statusParamLabel(status)} right now.`;
  switch (status) {
    case "DRAFT": {
      const due = of.filter((row) => row.flag?.kind === "apply-by" && row.flag.soon).length;
      return `${plural(of.length, "draft", "drafts")}.${due > 0 ? ` ${due} due this week.` : ""}`;
    }
    case "SENT": {
      const [quietest] = of.filter((row) => row.flag?.kind === "quiet").sort((a, b) => (b.quietDays ?? 0) - (a.quietDays ?? 0));
      return `${of.length} waiting to hear back.${quietest ? ` ${name(quietest)} has been quiet for ${quietest.quietDays} days.` : ""}`;
    }
    case "SCREENING": {
      const waiting = of.reduce((sum, row) => sum + row.waiting, 0);
      return `${of.length} in screening.${waiting > 0 ? ` ${plural(waiting, "reply is", "replies are")} waiting for you.` : ""}`;
    }
    case "INTERVIEW": {
      const [next] = of
        .filter((row) => row.nextInterview && row.flag?.kind === "interview" && row.flag.due)
        .sort((a, b) => a.flag!.due!.getTime() - b.flag!.due!.getTime());
      return `${of.length} interviewing.${next ? ` Next: ${name(next)}, ${next.nextInterview}.` : ""}`;
    }
    case "OFFER":
      return `${plural(of.length, "offer", "offers")} to decide on.`;
    case "closed": {
      const count = (wanted: ApplicationStatus) => of.filter((row) => row.status === wanted).length;
      return `${of.length} closed: ${count(ApplicationStatus.ACCEPTED)} accepted, ${count(ApplicationStatus.REJECTED)} rejected, ${count(ApplicationStatus.DECLINED)} declined.`;
    }
    default:
      return `${of.length} ${statusParamLabel(status).toLowerCase()}.`;
  }
}

/** "Today", "Yesterday", "3 days ago", "2 weeks ago", counting calendar days in the server's time zone. */
export function updatedAgo(date: Date, now = new Date()): string {
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const days = Math.max(0, Math.round((day(now) - day(date)) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

export const statusLabel = (status: ApplicationStatus) => statusInfo(status).label;
