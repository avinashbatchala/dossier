import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { JobSearchError } from "@/lib/job-search/errors";
import { EMPTY_QUERY } from "@/lib/job-search/search";

import { portalAdapter } from "./engine";
import { portalConfigSchema } from "./format";
import { fetchConfigText } from "./installed";
import { jsonSample } from "./samples.test-data";

// A portal the user added (E23-3) reaches its hosts only on the public
// internet: its requests go through undici with a lookup that refuses
// private addresses (the posting fetcher's), unless the host is one the
// user or the tests named.
// A plain function, not a mock, so a refusal it throws reaches only the code under test.
const undici = vi.hoisted(() => ({ answer: (): Promise<Response> => Promise.resolve(new Response("")), calls: [] as unknown[][] }));
vi.mock("undici", () => ({
  Agent: class {},
  fetch: (...args: unknown[]) => {
    undici.calls.push(args);
    return undici.answer();
  },
}));
const refused = () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "EPRIVATE" } }));
vi.mock("@/lib/posting-fetch", () => ({ guardedLookup: () => {}, isPublicAddress: (address: string) => !/^(127|10|192\.168)\.|^::1$/.test(address), fetchPosting: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const config = portalConfigSchema.parse(jsonSample);
const query = { ...EMPTY_QUERY, keywords: "designer", country: "de" };
const answer = { meta: { count: 0 }, results: [] };

beforeEach(() => {
  undici.calls.length = 0;
  undici.answer = () => Promise.resolve(new Response(""));
});
afterEach(() => vi.unstubAllGlobals());

describe("an added portal's requests", () => {
  it("go through the guarded connection to the config's hosts", async () => {
    undici.answer = async () => json(answer);
    await portalAdapter(config, { guarded: true }).search(query, { key: "sk" }, null);
    expect(undici.calls).toEqual([[expect.objectContaining({ hostname: "api.sample.example" }), expect.objectContaining({ dispatcher: expect.anything() })]]);
  });

  it("say so when a host turns out to be on a private network", async () => {
    undici.answer = refused;
    const error = await portalAdapter(config, { guarded: true })
      .search(query, { key: "sk" }, null)
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(JobSearchError);
    expect(error).toMatchObject({ problem: "changed", detail: "SAMPLE_JSON: /v2/de/jobs: api.sample.example is on a private network" });
  });

  it("go straight to the tests' address, and a built-in's go straight to its hosts", async () => {
    const requests = stubFetch(() => json(answer));
    await portalAdapter(config, { guarded: true }).search(query, { key: "sk" }, null, { baseUrl: "http://localhost:3998/sample" });
    await portalAdapter(config).search(query, { key: "sk" }, null);
    expect(requests).toHaveLength(2);
    expect(undici.calls).toEqual([]);
  });
});

describe("a config from a link", () => {
  it("is read over https from the public internet, up to a config's size", async () => {
    undici.answer = async () => new Response('{"id":"X"}');
    expect(await fetchConfigText("https://example.com/portal.json")).toEqual({ ok: true, text: '{"id":"X"}' });
    undici.answer = async () => new Response("x".repeat(201 * 1024));
    expect(await fetchConfigText("https://example.com/portal.json")).toEqual({ ok: false, problem: "It's bigger than a portal config can be (200 KB)." });
    undici.answer = async () => new Response("", { status: 404 });
    expect(await fetchConfigText("https://example.com/portal.json")).toEqual({ ok: false, problem: "The link answered with an error (HTTP 404)." });
  });

  it("isn't read from the user's own network or over http", async () => {
    expect(await fetchConfigText("http://example.com/portal.json")).toEqual({ ok: false, problem: "Use an https:// link to the config file." });
    for (const link of ["https://127.0.0.1/portal.json", "https://localhost/portal.json", "https://[::1]/portal.json"]) {
      expect(await fetchConfigText(link)).toEqual({ ok: false, problem: "Dossier doesn't read links on your own network." });
    }
    undici.answer = refused;
    expect(await fetchConfigText("https://intranet.example.com/portal.json")).toEqual({ ok: false, problem: "Dossier doesn't read links on your own network." });
    expect(undici.calls).toHaveLength(1);
  });
});
