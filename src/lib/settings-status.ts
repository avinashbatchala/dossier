import { formatShortDate } from "@/lib/dates";
import type { SearchPortal } from "@/lib/job-search/search";

// How each Settings section stands (E34-1): On, Needs a look or Off, with a
// line saying what it's set to, a quieter line under it and a short note for
// the section list. Worked out here from what the server already knows, so
// the overview, the section list and the problems banner always agree.
// Pure: settings-status-data.ts gathers what it needs.

export type SectionTone = "on" | "look" | "off";

/** What's wrong, for the overview's banner: a clause to join with the others, and its fix's button. */
type SectionProblem = { summary: string; fix: string };

export type SectionStatus = {
  tone: SectionTone;
  /** "Anthropic · claude-sonnet-5-5 · tested 1.4 s" */
  state: string;
  /** "Your profile leaves the server when it writes" */
  meta: string;
  /** Under the section's name in the list: "Anthropic · claude-sonnet-5-5", or the problem. */
  note: string;
  problem: SectionProblem | null;
};

/** A portal as Settings knows it: switched on, and whether what it needs is saved. */
type PortalStatusInput = { id: string; name: string; on: boolean; setupProblem: string | null };
/** One search, newest first: when it ran and what each portal answered. */
export type SearchRunInput = { at: Date; portals: readonly SearchPortal[] };

export type StatusInputs = {
  now: Date;
  ai: {
    /** Chosen in Settings or with DOSSIER_AI_*. */
    configured: boolean;
    name: string;
    model: string;
    /** On the user's hardware (ST3). */
    local: boolean;
    /** The key: missing where it's needed, or saved but unreadable. */
    keyProblem: "missing" | "unreadable" | null;
    /** The last test of this provider, address and model; null when there's none, or it tested something else. */
    test: { at: Date; ok: boolean; seconds: number | null; error: string | null } | null;
  };
  documents: { paper: string; language: string; tone: string };
  scoring: { name: string; problem: string | null; scoredThisMonth: number };
  jobs: { portals: readonly PortalStatusInput[]; runs: readonly SearchRunInput[] };
  agent: {
    enabled: boolean;
    searches: number;
    hour: number;
    maxDrafts: number;
    /** When it runs next, in words: "tomorrow at 07:00". */
    nextRun: string | null;
    /** The last finished run: when, and whether it failed. */
    lastRun: { at: Date; failed: boolean; message: string | null } | null;
    /** What stops it running at all, such as a portal without its key. */
    setupProblem: string | null;
  };
  google: { status: "not-configured" | "disconnected" | "connected"; email: string | null; canRead: boolean; canUseCalendar: boolean; lastSync: string | null; problem: string | null };
  notifications: { channels: readonly { name: string; summary: string; paused: boolean }[]; lastSent: string | null };
  connector: { on: boolean };
  data: { nightly: boolean; retentionDays: number; lastBackup: Date | null; lastBackupWords: string | null; problem: string | null };
  about: { version: string; update: string | null; database: string; applications: number };
};

/** The sections whose problems the banner lists, in the order it lists them (ST2). */
export const PROBLEM_ORDER = ["ai", "jobs", "scoring", "agent", "google", "notifications", "data", "about"] as const;

const DAY = 86_400_000;
/** A nightly backup older than this needs a look (ST2). */
const BACKUP_DAYS = 3;

const on = (state: string, meta: string, note = state): SectionStatus => ({ tone: "on", state, meta, note, problem: null });
const off = (state: string, meta: string, note = "Off"): SectionStatus => ({ tone: "off", state, meta, note, problem: null });
const look = (state: string, meta: string, note: string, problem: SectionProblem): SectionStatus => ({ tone: "look", state, meta, note, problem });

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hourOf = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function aiStatus({ ai }: StatusInputs, now: Date): SectionStatus {
  if (!ai.configured) return off("No AI provider chosen yet", "Dossier writes nothing until you choose one", "Not chosen yet");
  const meta = ai.local ? "Nothing leaves this computer" : "Your profile leaves the server when it writes";
  const name = [ai.name, ai.model].filter(Boolean).join(" · ");
  if (ai.keyProblem === "missing") return look(name, "It needs its API key to write", "Key missing", { summary: `your ${ai.name} key is missing`, fix: "Add the key" });
  if (ai.keyProblem === "unreadable") return look(name, "Enter it again: the saved one can't be read", "Key can't be read", { summary: `your ${ai.name} key can't be read`, fix: "Enter the key" });
  if (ai.test && !ai.test.ok) {
    return look(name, ai.test.error ?? "The connection test failed", "Test failed", { summary: `the AI connection test failed on ${formatShortDate(ai.test.at, now)}`, fix: "Test again" });
  }
  const tested = ai.test?.ok && ai.test.seconds !== null ? ` · tested ${ai.test.seconds} s` : "";
  return on(`${name}${tested}`, meta, name);
}

/**
 * A portal's trouble (E34-1, ST2): out of searches in its last search, or
 * failed in its last two, since the first of those failures.
 */
export function portalTrouble(id: string, runs: readonly SearchRunInput[]): { kind: "quota" | "failing"; since: Date; message: string | null } | null {
  // Its own answers, newest first; a skip for a country it doesn't cover says nothing about it.
  const answers = runs.flatMap((run) => run.portals.filter((portal) => portal.id === id && (portal.status !== "skipped" || portal.problem === "quota")).map((portal) => ({ at: run.at, portal })));
  const [last, before] = answers;
  if (!last) return null;
  if (last.portal.status === "skipped") return { kind: "quota", since: last.at, message: last.portal.message };
  if (last.portal.status !== "failed" || before?.portal.status !== "failed") return null;
  let since = before.at;
  for (const answer of answers.slice(2)) {
    if (answer.portal.status !== "failed") break;
    since = answer.at;
  }
  return { kind: "failing", since, message: last.portal.message };
}

function jobsStatus({ jobs }: StatusInputs, now: Date): SectionStatus {
  const switchedOn = jobs.portals.filter((portal) => portal.on);
  if (switchedOn.length === 0) return off("No portal switched on", "Choose where Dossier looks for postings");
  const problems = switchedOn.flatMap((portal) => {
    if (portal.setupProblem) return [{ portal, text: portal.setupProblem, summary: `${portal.name} needs its key`, note: `${portal.name} needs its key` }];
    const trouble = portalTrouble(portal.id, jobs.runs);
    if (!trouble) return [];
    return trouble.kind === "quota"
      ? [{ portal, text: trouble.message ?? `${portal.name} is out of searches`, summary: `${portal.name} is out of searches`, note: `${portal.name} is out of searches` }]
      : [{ portal, text: trouble.message ?? "", summary: `${portal.name} has failed since ${formatShortDate(trouble.since, now)}`, note: `${portal.name} stopped working` }];
  });
  const working = switchedOn.filter((portal) => !problems.some((problem) => problem.portal === portal));
  const meta = working.map((portal) => portal.name).join(", ") || "None working";
  if (problems.length === 0) return on(switchedOn.length === 1 ? `${switchedOn[0].name} is on` : `${switchedOn.length} portals on`, meta, switchedOn.map((portal) => portal.name).join(", "));
  const [first] = problems;
  const state = `${working.length} of ${plural(switchedOn.length, "portal")} working. ${first.summary.charAt(0).toUpperCase()}${first.summary.slice(1)}.`;
  return look(state, meta, first.note, { summary: problems.map((problem) => problem.summary).join(", "), fix: `Fix ${first.portal.name}` });
}

function scoringStatus({ scoring }: StatusInputs): SectionStatus {
  const meta = scoring.scoredThisMonth === 0 ? "Nothing scored this month yet" : `${plural(scoring.scoredThisMonth, "posting")} scored this month`;
  if (scoring.problem) return look(scoring.name, scoring.problem, "Needs a look", { summary: "scoring can't run", fix: "Fix scoring" });
  return on(`${scoring.name}, with reasons`, meta, scoring.name);
}

function agentStatus({ agent }: StatusInputs, now: Date): SectionStatus {
  if (!agent.enabled) return off("Searches each day and drafts what fits", "Off");
  const state = `${plural(agent.searches, "search", "searches")}, daily at ${hourOf(agent.hour)} · up to ${plural(agent.maxDrafts, "draft")}`;
  const meta = agent.nextRun ? `Next run ${agent.nextRun}` : "Waiting for its first run";
  if (agent.setupProblem) return look(state, agent.setupProblem, "Can't run", { summary: "the job agent can't run", fix: "See the agent" });
  if (agent.lastRun?.failed) {
    return look(state, agent.lastRun.message ?? "Its last run failed", "Last run failed", { summary: `the job agent's run on ${formatShortDate(agent.lastRun.at, now)} failed`, fix: "See the agent" });
  }
  return on(state, meta, `On · daily at ${hourOf(agent.hour)}`);
}

function googleStatus({ google }: StatusInputs): SectionStatus {
  if (google.status !== "connected") return off("Gmail and Calendar", google.status === "not-configured" ? "Needs a Google client first" : "Not connected");
  const parts = [google.canRead && "Gmail", google.canUseCalendar && "Calendar"].filter(Boolean).join(" and ") || "Google";
  const state = `${parts} as ${google.email}`;
  if (google.problem) return look(state, google.problem, "Needs a look", { summary: "Google stopped syncing", fix: "Reconnect Google" });
  return on(state, google.lastSync ? `Checked for replies ${google.lastSync}` : "Not checked yet", parts);
}

function notificationsStatus({ notifications }: StatusInputs): SectionStatus {
  const { channels } = notifications;
  if (channels.length === 0) return off("Email, ntfy or a webhook", "No channel yet");
  const state = channels.length === 1 ? `${channels[0].name}${channels[0].summary ? `: ${channels[0].summary}` : ""}` : `${channels.length} channels`;
  const meta = notifications.lastSent ? `Last sent ${notifications.lastSent}` : "Nothing sent yet";
  const paused = channels.find((channel) => channel.paused);
  if (paused) return look(state, meta, `${paused.name} is paused`, { summary: `the ${paused.name} channel is paused`, fix: "Resume it" });
  return on(state, meta, plural(channels.length, "channel"));
}

function dataStatus({ data }: StatusInputs, now: Date): SectionStatus {
  const state = data.nightly ? `Nightly backup on · kept ${plural(data.retentionDays, "day")}` : "Nightly backup off";
  const meta = data.lastBackupWords ? `Last: ${data.lastBackupWords}` : "No backup yet";
  if (data.problem) return look(state, data.problem, "Backup failed", { summary: "the last backup failed", fix: "See backups" });
  const stale = !data.lastBackup || now.getTime() - data.lastBackup.getTime() > BACKUP_DAYS * DAY;
  if (stale) return look(state, meta, "No recent backup", { summary: `there's no backup from the last ${BACKUP_DAYS} days`, fix: "Back up" });
  return on(state, meta, data.lastBackupWords ? `Backed up ${data.lastBackupWords}` : state);
}

function aboutStatus({ about }: StatusInputs): SectionStatus {
  const meta = `${about.database} · ${plural(about.applications, "application")}`;
  if (about.update) return look(`You have ${about.version} · ${about.update} is out`, meta, `${about.update} is out`, { summary: `Dossier ${about.update} is out`, fix: "See what's new" });
  return on(`You have ${about.version}, the latest`, meta, about.version);
}

/** Every section's status. */
export function settingsStatus(inputs: StatusInputs) {
  const { now } = inputs;
  return {
    ai: aiStatus(inputs, now),
    documents: on(`${inputs.documents.paper} · ${inputs.documents.language} · ${inputs.documents.tone.toLowerCase()} tone`, "Resume and letter, as you set them", `${inputs.documents.paper} · ${inputs.documents.language}`),
    scoring: scoringStatus(inputs),
    jobs: jobsStatus(inputs, now),
    agent: agentStatus(inputs, now),
    google: googleStatus(inputs),
    notifications: notificationsStatus(inputs),
    connector: inputs.connector.on ? on("Use Dossier from Claude and other MCP apps", "On") : off("Use Dossier from Claude and other MCP apps", "Off"),
    data: dataStatus(inputs, now),
    about: aboutStatus(inputs),
  } satisfies Record<string, SectionStatus>;
}
export type SettingsStatus = ReturnType<typeof settingsStatus>;

const NUMBERS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];

/**
 * The overview's banner (E34-2): "Two things to look at. Your Adzuna key
 * stopped working on 12 Nov, and Dossier 1.16 is out." and the first
 * fix, or null when nothing needs a look.
 */
export function problemsBanner(status: SettingsStatus): { title: string; summary: string; fix: { label: string; section: (typeof PROBLEM_ORDER)[number] } } | null {
  const problems = PROBLEM_ORDER.flatMap((id) => (status[id].problem ? [{ id, problem: status[id].problem! }] : []));
  if (problems.length === 0) return null;
  const count = problems.length === 1 ? "One thing" : `${NUMBERS[problems.length] ?? problems.length} things`;
  const clauses = problems.map(({ problem }) => problem.summary);
  const joined = clauses.length === 1 ? clauses[0] : `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1)}`;
  return {
    title: `${count} to look at.`,
    summary: `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`,
    fix: { label: problems[0].problem.fix, section: problems[0].id },
  };
}
