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
  ) {
    super(message);
  }
}
