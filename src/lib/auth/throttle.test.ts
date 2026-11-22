import { describe, expect, it } from "vitest";

import {
  afterFailure,
  GLOBAL,
  PER_IP,
  pausedForNewBrowsersMessage,
  tooManyAttemptsMessage,
  waitMs,
  type ThrottleState,
} from "./throttle";

const start = new Date("2026-09-28T09:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);
const S = 1000;

/** Fails `count` times, `gap` ms apart, starting at `from`; returns the final state and time. */
function fail(count: number, gap: number, state: ThrottleState | null = null, from = 0) {
  let now = from;
  for (let i = 0; i < count; i++) {
    state = afterFailure(state, at(now), PER_IP);
    if (i < count - 1) now += gap;
  }
  return { state: state!, now };
}

describe("per-IP backoff", () => {
  it("allows four quick failures", () => {
    const { state, now } = fail(4, S);
    expect(state.failures).toBe(4);
    expect(waitMs(state, at(now))).toBe(0);
  });

  it("blocks for 30 s after the fifth failure within a minute", () => {
    const { state, now } = fail(5, S);
    expect(waitMs(state, at(now))).toBe(30 * S);
    expect(waitMs(state, at(now + 30 * S))).toBe(0);
  });

  it("doubles the block with each further failure, up to 15 minutes", () => {
    let { state, now } = fail(5, S);
    const blocks = [waitMs(state, at(now))];
    for (let i = 0; i < 7; i++) {
      now = state.blockedUntil!.getTime() - start.getTime(); // try again as soon as allowed
      state = afterFailure(state, at(now), PER_IP);
      blocks.push(waitMs(state, at(now)));
    }
    expect(blocks.map((ms) => ms / S)).toEqual([30, 60, 120, 240, 480, 900, 900, 900]);
  });

  it("forgets failures spread over more than a minute", () => {
    const { state, now } = fail(4, 20 * S); // 4 failures over 60 s
    const next = afterFailure(state, at(now + 61 * S), PER_IP);
    expect(next.failures).toBe(1);
    expect(waitMs(next, at(now + 61 * S))).toBe(0);
  });

  it("starts over 15 minutes after the last block ended", () => {
    const { state } = fail(5, S);
    const later = state.blockedUntil!.getTime() - start.getTime() + 15 * 60 * S + 1;
    expect(afterFailure(state, at(later), PER_IP)).toMatchObject({ failures: 1, blockedUntil: null });
  });

  it("has no wait without a state", () => {
    expect(waitMs(null, start)).toBe(0);
  });
});

describe("global backstop", () => {
  it("allows 29 failures in 10 minutes, then blocks", () => {
    let state: ThrottleState | null = null;
    for (let i = 0; i < 29; i++) state = afterFailure(state, at(i * 20 * S), GLOBAL);
    expect(waitMs(state, at(29 * 20 * S))).toBe(0);
    state = afterFailure(state, at(29 * 20 * S), GLOBAL);
    expect(waitMs(state, at(29 * 20 * S))).toBe(30 * S);
  });
});

describe("message", () => {
  it("says how long to wait", () => {
    expect(tooManyAttemptsMessage(30 * S)).toBe("Too many attempts. Try again in 30 seconds.");
    expect(tooManyAttemptsMessage(400)).toBe("Too many attempts. Try again in 1 second.");
    expect(tooManyAttemptsMessage(119.5 * S)).toBe("Too many attempts. Try again in 2 minutes.");
    expect(tooManyAttemptsMessage(15 * 60 * S)).toBe("Too many attempts. Try again in 15 minutes.");
  });

  it("tells a new browser stopped by the limit on everyone how to get in anyway (#334)", () => {
    expect(pausedForNewBrowsersMessage(90 * S)).toBe(
      "Too many wrong passwords were tried lately, so new browsers have to wait 90 seconds. A browser you've signed in with before can sign in now, and restarting Dossier ends the wait.",
    );
  });
});
