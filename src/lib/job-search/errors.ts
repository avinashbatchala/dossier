import { countryName } from "./countries";
import type { JobSource } from "./search";
import { SOURCE_INFO } from "./sources";

// What can go wrong when searching a job source, in words people can act on
// (E14-1). A source's own error text never reaches the screen or the logs.

export type JobSearchProblem =
  /** The source isn't offered on this server (DOSSIER_JOBS_ARBEITSAGENTUR=off). */
  | "off"
  /** The Bundesagentur für Arbeit's note hasn't been accepted yet (#223). */
  | "not-accepted"
  /** No key saved for a source that needs one. */
  | "no-key"
  /** The source refused the key. */
  | "key"
  /** The plan's searches are used up. */
  | "quota"
  /** The source doesn't list jobs in that country. */
  | "country"
  /** The source can't be reached, or failed on its side. */
  | "unavailable"
  /** The source answered in a shape Dossier doesn't know: its API changed. */
  | "changed";

export class JobSearchError extends Error {
  override name = "JobSearchError";

  constructor(
    readonly problem: JobSearchProblem,
    message: string,
    /** For the server log: the source, the call and the status, never the search. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** The error for `problem` with `source`, worded for the screen. */
export function jobSearchError(problem: JobSearchProblem, source: JobSource, { country = "", detail }: { country?: string; detail?: string } = {}) {
  const { name, quotaPeriod } = SOURCE_INFO[source];
  const message = {
    off: `${name} isn't offered on this server. Choose another source in Settings → Job search.`,
    "not-accepted": `Read the note about ${name} and tick “I understand” before Dossier searches it.`,
    "no-key": `Add your ${name} ${source === "ADZUNA" ? "app ID and key" : "key"} in Settings → Job search first.`,
    key: `${name} didn't accept your key. Check it in Settings → Job search.`,
    quota: quotaPeriod
      ? `You've used up your ${name} searches for ${quotaPeriod}. Try again then, or move to a bigger plan.`
      : `${name} is limiting searches right now. Wait a minute and try again.`,
    country: `${name} doesn't list jobs in ${countryName(country)}. Choose another country, or another source in Settings → Job search.`,
    unavailable: `${name} isn't answering right now. Try again in a minute.`,
    changed:
      source === "ARBEITSAGENTUR"
        ? "The Arbeitsagentur's job search has changed or isn't answering. Try another source in Settings → Job search."
        : `${name} answered in a way Dossier doesn't understand; its service may have changed. Try again later.`,
  }[problem];
  return new JobSearchError(problem, message, detail ? `${source}: ${detail}` : undefined);
}
