import { afterEach, describe, expect, it, vi } from "vitest";

import { json, refused, stubFetch } from "@/lib/ai/test-http";

import { getJson, getSitePage, getText, STARTUPS_USER_AGENT, testAddress } from "./http";

const state = vi.hoisted(() => ({ base: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({
  env: {
    get DOSSIER_JOBS_TEST_BASE_URL() {
      return state.base;
    },
  },
}));
const fetchHtml = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchHtml }));

afterEach(() => {
  vi.unstubAllGlobals();
  fetchHtml.mockReset();
  state.base = undefined;
});

describe("Startups' requests (#222)", () => {
  it("say what they are, and link to the page explaining them", () => {
    expect(STARTUPS_USER_AGENT).toMatch(/^Mozilla\/5\.0 \(compatible; Dossier\/[\w.-]+; \+https:\/\/github\.com\/AienTech\/dossier\/blob\/main\/PRIVACY\.md#startups\)$/);
  });

  it("go to the fake server in the end-to-end tests", () => {
    expect(testAddress("https://hn.algolia.com/api/v1/items/1?x=2")).toBe("https://hn.algolia.com/api/v1/items/1?x=2");
    expect(testAddress("https://hn.algolia.com/api/v1/items/1?x=2", "http://localhost:3998/")).toBe("http://localhost:3998/startups/hn.algolia.com/api/v1/items/1?x=2");
  });

  it("say why a source failed", async () => {
    stubFetch(() => json({}, { status: 503 }));
    await expect(getText("https://example.com/a")).rejects.toThrow("answered with an error (503)");
    stubFetch(() => refused());
    await expect(getText("https://example.com/a")).rejects.toThrow("couldn't be reached");
    stubFetch(() => new Response("x", { headers: { "content-length": String(10 * 1024 * 1024) } }));
    await expect(getText("https://example.com/a")).rejects.toThrow("sent too much");
    stubFetch(() => new Response("not json"));
    await expect(getJson("https://example.com/a")).rejects.toThrow("didn't answer with JSON");
    const stopped = new AbortController();
    stopped.abort();
    stubFetch((_, signal) => Promise.reject(signal?.reason));
    await expect(getText("https://example.com/a", { signal: stopped.signal })).rejects.toThrow("was stopped");
  });

  it("read a startup's page with Dossier's user agent, and give its real address back in the tests", async () => {
    fetchHtml.mockResolvedValue({ ok: true, html: "<p>hi</p>", url: "https://acme.com/careers" });
    expect(await getSitePage("https://acme.com/careers")).toEqual({ ok: true, html: "<p>hi</p>", url: "https://acme.com/careers" });
    expect(fetchHtml).toHaveBeenCalledWith("https://acme.com/careers", { timeoutMs: undefined, userAgent: STARTUPS_USER_AGENT });

    state.base = "http://localhost:3998";
    fetchHtml.mockResolvedValue({ ok: true, html: "", url: "http://localhost:3998/startups/acme.com/jobs" });
    expect(await getSitePage("https://acme.com/careers", { timeoutMs: 5 })).toMatchObject({ url: "https://acme.com/jobs" });
    expect(fetchHtml.mock.calls[1][0]).toBe("http://localhost:3998/startups/acme.com/careers");
    fetchHtml.mockResolvedValue({ ok: false, error: "nope", status: 404 });
    expect(await getSitePage("https://acme.com/x")).toEqual({ ok: false, error: "nope", status: 404 });
  });
});
