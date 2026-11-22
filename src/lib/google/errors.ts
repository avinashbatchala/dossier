/** Why talking to Google failed; the message is written for the user. */
export type GoogleProblem = "not-configured" | "not-connected" | "revoked" | "rejected" | "scope" | "unavailable" | "quota";

/** A failure talking to Google, with a message that never contains a token. */
export class GoogleError extends Error {
  override name = "GoogleError";
  constructor(
    readonly problem: GoogleProblem,
    message: string,
    /** For the server log only. */
    readonly detail?: string,
    /** Google's HTTP status, when it answered with an error. */
    readonly status?: number,
    /** How long Google asked to wait before trying again (Retry-After), when it said. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Whether a failure is one that passes: Google asked for a pause, or had a problem of its own. Worth trying again. */
export const isPassing = (error: unknown) => error instanceof GoogleError && (error.problem === "quota" || (error.status ?? 0) >= 500);

/** Whether a failure means the thing is gone: deleted, or never there. */
export const isGone = (error: unknown) => error instanceof GoogleError && (error.status === 404 || error.status === 410);
