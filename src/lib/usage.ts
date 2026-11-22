import { DASHBOARD_PERIODS, type DashboardPeriod } from "@/lib/dashboard";
import { SCORER_USAGE } from "@/lib/scoring/scorers";

// Tokens used per AI task (#290): the categories the Usage screen lists, and
// its figures from what AiUsage holds (src/lib/usage-data.ts).

/** Everything that asks the AI model, or Jev, for an answer, in the order the screen lists them at rest. */
export const USAGE_TASKS = [
  { task: "extract-profile", label: "Importing a profile", hint: "A resume read into your profile" },
  { task: "guess-levels", label: "Guessing levels", hint: "Guess with AI on a profile's levels" },
  // One row per scoring model (E25-2).
  ...SCORER_USAGE,
  { task: "extract-posting", label: "Reading postings", hint: "What a posting asks for, when you start an application" },
  { task: "match-requirements", label: "Matching requirements", hint: "Your profile against what a posting asks for" },
  { task: "tailor-resume", label: "Writing resumes", hint: "Each application's tailored resume" },
  { task: "write-cover-letter", label: "Writing cover letters", hint: "Each application's cover letter" },
  { task: "write-email", label: "Writing emails", hint: "The email to send with an application" },
  { task: "regenerate-unit", label: "Rewriting parts", hint: "One part of a resume or letter, written again" },
  { task: "refine-chat", label: "Refining in chat", hint: "Changes you ask for in an application's chat" },
  { task: "answer-question", label: "Answering questions", hint: "Questions you ask about an application (Ask)" },
  { task: "prepare-interview", label: "Getting ready", hint: "The checklist Prepare writes for an interview" },
  { task: "write-message", label: "Drafting messages", hint: "Follow-ups, and answers to an offer" },
  { task: "classify-reply", label: "Reading replies", hint: "Employers' mail from Gmail, read in the background" },
  { task: "draft-reply", label: "Drafting answers", hint: "Your answers to employers' replies" },
  { task: "daily-note", label: "Daily notes", hint: "The dashboard's note, once a day" },
  { task: "connection-check", label: "Connection checks", hint: "Test connection in Settings" },
] as const;

export type UsageTask = (typeof USAGE_TASKS)[number]["task"];

/** The tokens one answer used, as its server counted them; null where it didn't say. */
export type TokenCount = { input: number | null; output: number | null };

/** One answered request, as AiUsage keeps it. */
export type UsageEntry = TokenCount & {
  task: UsageTask;
  /** The provider's kind, e.g. "ANTHROPIC", or "JEV". */
  provider: string;
  model: string;
};

/** Keeps each answered request's tokens; never fails the request. */
export type UsageSink = (entry: UsageEntry) => void;

/** What AiUsage holds for one task in a period. */
export type UsageGroup = {
  task: string;
  requests: number;
  /** How many requests had input tokens reported, and their sum. */
  inputRequests: number;
  input: number;
  outputRequests: number;
  output: number;
};

/** Tokens summed over the requests whose server reported them; null when none did. */
export type TokenSum = { tokens: number | null; unreported: number };

export type UsageTotals = { requests: number; input: TokenSum; output: TokenSum; total: number | null };
type UsageRow = UsageTotals & { task: UsageTask; label: string; hint: string };
export type UsageFigures = { rows: UsageRow[]; total: UsageTotals };

const DAY_MS = 86_400_000;

/** Where `period` starts, or null for all time. */
export function usageSince(period: DashboardPeriod, now: Date): Date | null {
  const days = DASHBOARD_PERIODS.find((entry) => entry.value === period)?.days ?? null;
  return days === null ? null : new Date(now.getTime() - days * DAY_MS);
}

function sum(requests: number, reported: number, tokens: number): TokenSum {
  return { tokens: reported === 0 && requests > 0 ? null : tokens, unreported: requests - reported };
}

function totals(requests: number, input: TokenSum, output: TokenSum): UsageTotals {
  const total = input.tokens === null && output.tokens === null ? null : (input.tokens ?? 0) + (output.tokens ?? 0);
  return { requests, input, output, total };
}

/**
 * A row for every task, the ones that used the most tokens first; tasks
 * without requests keep their usual order at the end. Tasks this version
 * doesn't know are left out.
 */
export function usageFigures(groups: UsageGroup[]): UsageFigures {
  const byTask = new Map(groups.map((group) => [group.task, group]));
  const rows = USAGE_TASKS.map(({ task, label, hint }): UsageRow => {
    const group = byTask.get(task);
    const requests = group?.requests ?? 0;
    return {
      task,
      label,
      hint,
      ...totals(requests, sum(requests, group?.inputRequests ?? 0, group?.input ?? 0), sum(requests, group?.outputRequests ?? 0, group?.output ?? 0)),
    };
  });
  rows.sort((a, b) => (b.total ?? 0) - (a.total ?? 0) || b.requests - a.requests);

  const known = rows.map((row) => byTask.get(row.task)).filter((group) => group !== undefined);
  const add = (pick: (group: UsageGroup) => number) => known.reduce((total, group) => total + pick(group), 0);
  const requests = add((group) => group.requests);
  return {
    rows,
    total: totals(
      requests,
      sum(requests, add((group) => group.inputRequests), add((group) => group.input)),
      sum(requests, add((group) => group.outputRequests), add((group) => group.output)),
    ),
  };
}
