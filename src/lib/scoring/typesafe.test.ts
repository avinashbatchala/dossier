import { afterEach, describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";

import { askJev, JEV_MODEL, TYPESAFE_URL, type Question } from "./typesafe";

const questions: Record<string, Question> = { billing: { type: "noul", instructions: "Is this about billing?" } };
const request = { state: { message: "I was charged twice." }, questions };
const answer = { model: "jev-1.14.0", answers: { billing: { type: "noul", noul: 0.97 } } };
const answered = { ...answer, usage: { input_tokens: 42 } };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A fetch that answers with `responses` in turn, and remembers what it was asked. */
function fakeFetch(...responses: (Response | Error)[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("asked once too often");
    if (next instanceof Error) throw next;
    return next;
  });
}

const ask = (fetchImpl: typeof fetch, options: Partial<Parameters<typeof askJev>[1]> = {}) =>
  askJev(request, { key: "ts-key", fetchImpl, baseUrl: TYPESAFE_URL, retryDelaysMs: [0, 0], ...options });

/** The AiError `promise` fails with. */
async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AiError);
  return error as AiError;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("askJev (#274)", () => {
  it("asks TypeSafe's System One API with the key, and returns the answers", async () => {
    const fetchImpl = fakeFetch(json({ ...answer, usage: { input_tokens: 42, output_tokens: 3 } }));
    expect(await ask(fetchImpl)).toEqual(answered);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ts-key");
    expect(JSON.parse(String(init?.body))).toEqual({ model: JEV_MODEL, ...request });
  });

  it("tries a rate limit or an overload again, then gives up with words to act on", async () => {
    expect(await ask(fakeFetch(json({}, 429), json({}, 529), json(answered)))).toEqual(answered);

    const limited = await failure(ask(fakeFetch(json({}, 429), json({}, 429), json({}, 429))));
    expect(limited).toMatchObject({ kind: "rate-limited", message: "TypeSafe is limiting requests right now. Wait a minute and try again.", detail: "TypeSafe 429" });
    expect(await failure(ask(fakeFetch(json({}, 529)), { retryDelaysMs: [] }))).toMatchObject({ kind: "busy", message: "TypeSafe is overloaded right now. Try again in a moment." });
  });

  it("waits as long as Retry-After asks, within ten seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = fakeFetch(json({}, 429, { "retry-after": "60" }), json(answered));
    const asking = ask(fetchImpl, { retryDelaysMs: [1] });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await asking).toEqual(answered);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails at once on anything else, without showing TypeSafe's own message", async () => {
    const cases: [Response, string, string][] = [
      [json({ detail: "bad key ts-k***" }, 401), "auth", "TypeSafe didn't accept the key. Check it in Settings → Scoring."],
      [json({}, 403), "auth", "TypeSafe didn't accept the key. Check it in Settings → Scoring."],
      [json({ error: "max_tokens_exceeded" }, 400), "too-long", "The posting and your profile are more than Jev can read at once. Try a shorter posting."],
      [json({}, 413), "too-long", "The posting and your profile are more than Jev can read at once. Try a shorter posting."],
      [json({ detail: [{ loc: ["questions"] }] }, 422), "provider", "TypeSafe couldn't score this posting. Try again in a moment."],
      [json({}, 400), "provider", "TypeSafe couldn't score this posting. Try again in a moment."],
      [json({}, 500), "provider", "TypeSafe couldn't score this posting. Try again in a moment."],
    ];
    for (const [response, kind, message] of cases) {
      const fetchImpl = fakeFetch(response);
      const error = await failure(ask(fetchImpl));
      expect(error).toMatchObject({ kind, message });
      expect(error.message).not.toContain("ts-k");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("says when TypeSafe can't be reached, was cancelled or took too long", async () => {
    expect(await failure(ask(fakeFetch(new TypeError("fetch failed"))))).toMatchObject({ kind: "unreachable", message: "Couldn't reach TypeSafe. Check that the server can reach the internet." });

    const controller = new AbortController();
    controller.abort();
    expect(await failure(ask(fakeFetch(new DOMException("aborted", "AbortError")), { signal: controller.signal }))).toMatchObject({ kind: "cancelled" });

    const hanging: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))));
    expect(await failure(ask(hanging, { timeoutMs: 5 }))).toMatchObject({ kind: "timeout", message: "TypeSafe took too long to answer. Try again." });
  });

  it("stops waiting to try again when cancelled", async () => {
    const controller = new AbortController();
    const fetchImpl = fakeFetch(json({}, 429));
    const asking = ask(fetchImpl, { signal: controller.signal, retryDelaysMs: [60_000] });
    controller.abort();
    expect(await failure(asking)).toMatchObject({ kind: "cancelled" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses an answer that isn't in System One's shape", async () => {
    for (const body of [{ answers: {} }, { model: "jev-1.14.0", answers: { billing: { type: "noul" } } }, "not json"]) {
      const response = typeof body === "string" ? new Response(body, { status: 200 }) : json(body);
      expect(await failure(ask(fakeFetch(response)))).toMatchObject({ kind: "invalid-output" });
    }
  });
});
