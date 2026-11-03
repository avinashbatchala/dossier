import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { requestJson } from "./http";

const url = new URL("https://jobs.example/api/search?q=designer");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("requestJson", () => {
  it("returns the parsed answer and asks for JSON", async () => {
    const requests = stubFetch(() => json({ ok: true }));
    expect(await requestJson("JSEARCH", url, { headers: { "x-api-key": "k" } })).toEqual({ ok: true });
    expect(requests[0].headers.get("accept")).toBe("application/json");
    expect(requests[0].headers.get("x-api-key")).toBe("k");
  });

  it("names the path and status for the log, never the search", async () => {
    stubFetch(() => json({}, { status: 500 }));
    await expect(requestJson("ADZUNA", url)).rejects.toMatchObject({ problem: "unavailable", detail: "ADZUNA: /api/search: HTTP 500" });
  });

  it("says the source changed when the answer isn't JSON", async () => {
    stubFetch(() => new Response("<html>Moved</html>", { status: 200 }));
    await expect(requestJson("ARBEITSAGENTUR", url)).rejects.toMatchObject({ problem: "changed", detail: "ARBEITSAGENTUR: /api/search: not JSON" });
  });

  it("refuses answers over 5 MB", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    stubFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 6; index++) controller.enqueue(chunk);
              controller.close();
            },
          }),
        ),
    );
    await expect(requestJson("JSEARCH", url)).rejects.toMatchObject({ problem: "changed", detail: expect.stringContaining("answer over") });
  });

  it("reads an empty body as empty, which isn't JSON", async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    await expect(requestJson("JSEARCH", url)).rejects.toMatchObject({ problem: "changed" });
  });

  it("says it timed out when the source takes too long", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    stubFetch((_, signal) => Promise.reject(signal?.reason ?? new Error("aborted")));
    await expect(requestJson("JSEARCH", url)).rejects.toMatchObject({ problem: "unavailable", detail: "JSEARCH: /api/search: timed out" });
  });

  it("gives a source 10 seconds unless it asks for longer (#231)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubFetch(() => json({ ok: true }));
    await requestJson("ADZUNA", url);
    await requestJson("JSEARCH", url, { timeoutMs: 45_000 });
    expect(timeout.mock.calls).toEqual([[10_000], [45_000]]);
  });

  it("gives up when the caller does, however long it would wait", async () => {
    const caller = new AbortController();
    caller.abort();
    stubFetch((_, signal) => Promise.reject(signal?.reason ?? new Error("aborted")));
    await expect(requestJson("JSEARCH", url, { signal: caller.signal, timeoutMs: 45_000 })).rejects.toMatchObject({
      problem: "unavailable",
      detail: "JSEARCH: /api/search: request failed",
    });
  });
});
