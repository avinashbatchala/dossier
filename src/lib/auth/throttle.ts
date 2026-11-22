// The backoff schedule for failed sign-ins (PRD AUTH-5), without the database.

export type ThrottlePolicy = {
  /** Failures allowed within `windowMs` before attempts are refused. */
  maxFailures: number;
  windowMs: number;
  /** The first block; each further failure doubles it, up to `maxBlockMs`. */
  baseBlockMs: number;
  maxBlockMs: number;
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Per client IP: 5 failures within a minute, then 30 s, 60 s, 120 s… up to 15 minutes. */
export const PER_IP: ThrottlePolicy = {
  maxFailures: 5,
  windowMs: MINUTE,
  baseBlockMs: 30 * SECOND,
  maxBlockMs: 15 * MINUTE,
};

/**
 * All IPs together, as a backstop: without a reverse proxy, X-Forwarded-For
 * can be faked, so rotating it mustn't allow unlimited guesses (decision in #30).
 */
export const GLOBAL: ThrottlePolicy = {
  maxFailures: 30,
  windowMs: 10 * MINUTE,
  baseBlockMs: 30 * SECOND,
  maxBlockMs: 15 * MINUTE,
};

export type ThrottleState = {
  failures: number;
  windowStart: Date;
  blockedUntil: Date | null;
};

/** Milliseconds until attempts are allowed again; 0 when they are. */
export function waitMs(state: ThrottleState | null, now: Date): number {
  if (!state?.blockedUntil) return 0;
  return Math.max(0, state.blockedUntil.getTime() - now.getTime());
}

/** The state after one more failed attempt. */
export function afterFailure(
  state: ThrottleState | null,
  now: Date,
  policy: ThrottlePolicy,
): ThrottleState {
  const elapsed = (since: Date) => now.getTime() - since.getTime();
  // Start over when the window passed without a block, or long after the last block ended.
  const startOver =
    !state ||
    (state.blockedUntil === null && elapsed(state.windowStart) > policy.windowMs) ||
    (state.blockedUntil !== null && elapsed(state.blockedUntil) > policy.maxBlockMs);
  const base = startOver ? { failures: 0, windowStart: now, blockedUntil: null } : state;

  const failures = base.failures + 1;
  if (failures < policy.maxFailures) return { ...base, failures };
  const block = Math.min(
    policy.baseBlockMs * 2 ** (failures - policy.maxFailures),
    policy.maxBlockMs,
  );
  return { failures, windowStart: base.windowStart, blockedUntil: new Date(now.getTime() + block) };
}

/** "Too many attempts. Try again in 30 seconds." (in minutes from two minutes on) */
export function tooManyAttemptsMessage(ms: number): string {
  return `Too many attempts. Try again in ${duration(ms)}.`;
}

/**
 * When only the limit on everyone stopped a browser that never signed in
 * here (#334): it isn't this browser's fault, and there are two ways round it.
 */
export function pausedForNewBrowsersMessage(ms: number): string {
  return `Too many wrong passwords were tried lately, so new browsers have to wait ${duration(ms)}. A browser you've signed in with before can sign in now, and restarting Dossier ends the wait.`;
}

/** "30 seconds", or in minutes from two minutes on. */
function duration(ms: number): string {
  const seconds = Math.ceil(ms / SECOND);
  return seconds < 120 ? `${seconds} ${seconds === 1 ? "second" : "seconds"}` : `${Math.ceil(seconds / 60)} minutes`;
}
