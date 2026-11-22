import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { jsearchV2LastPage, jsearchV2Page } from "@/test/job-search-fixtures";

import { clearJobSearchCache } from "./cache";
import { postingDetails, searchPostings, testSource } from "./index";
import { EMPTY_QUERY } from "./search";
import { sourceCovers } from "./sources";

const query = { ...EMPTY_QUERY, keywords: "designer", country: "de" };
const ninja = { key: "ak_test", host: "openwebninja" as const };

beforeEach(() => {
  clearJobSearchCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchPostings", () => {
  it("asks the source once per half hour for the same search and page", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const first = await searchPostings("JSEARCH", ninja, query);
    const again = await searchPostings("JSEARCH", ninja, query);
    expect(again).toEqual(first);
    expect(requests).toHaveLength(1);

    await searchPostings("JSEARCH", ninja, query, first.next);
    await searchPostings("JSEARCH", ninja, { ...query, remoteOnly: true });
    expect(requests).toHaveLength(3);
  });

  it("leaves out postings clearly for another level, whatever the source could filter (public issue 59)", async () => {
    stubFetch(() => json(jsearchV2Page));
    // The fixture: a Senior Product Designer, and a UX Researcher whose posting doesn't say.
    const junior = await searchPostings("JSEARCH", ninja, { ...query, experience: "junior" });
    expect(junior.postings.map((posting) => posting.title)).toEqual(["UX Researcher"]);
    const senior = await searchPostings("JSEARCH", ninja, { ...query, experience: "senior" });
    expect(senior.postings.map((posting) => posting.title)).toEqual(["Senior Product Designer, Payments", "UX Researcher"]);
    expect((await searchPostings("JSEARCH", ninja, query)).postings).toHaveLength(2);
  });

  it("doesn't keep failures", async () => {
    let status = 503;
    const requests = stubFetch(() => json(jsearchV2LastPage, { status }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "unavailable" });
    status = 200;
    await expect(searchPostings("JSEARCH", ninja, query)).resolves.toMatchObject({ next: null });
    expect(requests).toHaveLength(2);
  });

  it("logs problems with the source without the search, but not a wrong key", async () => {
    const log = vi.mocked(console.error);
    stubFetch(() => json({}, { status: 404 }));
    await expect(searchPostings("JSEARCH", ninja, query)).rejects.toMatchObject({ problem: "changed" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[job search] Error: JSEARCH: /jsearch/search-v2: HTTP 404");
    expect(String(log.mock.calls[0][0])).not.toContain("designer");

    stubFetch(() => json({}, { status: 401 }));
    await expect(searchPostings("JSEARCH", ninja, { ...query, keywords: "other" })).rejects.toMatchObject({ problem: "key" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("says when a source doesn't cover the country, before asking it", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    await expect(searchPostings("ARBEITSAGENTUR", {}, { ...query, country: "fr" })).rejects.toMatchObject({
      problem: "country",
      message: "Bundesagentur für Arbeit doesn't list jobs in France. Choose another country, or another source in Settings → Job search.",
    });
    expect(requests).toHaveLength(0);
    expect(sourceCovers("ADZUNA", "de")).toBe(true);
    expect(sourceCovers("ADZUNA", "jp")).toBe(false);
    expect(sourceCovers("JSEARCH", "jp")).toBe(true);
  });
});

describe("postingDetails", () => {
  it("returns a complete description as it is", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    expect(await postingDetails("JSEARCH", ninja, posting)).toBe(posting.description);
    expect(requests).toHaveLength(1);
  });

  it("asks the source for the rest of an incomplete one, and keeps it", async () => {
    stubFetch(() => json(jsearchV2Page));
    const [posting] = (await searchPostings("JSEARCH", ninja, query)).postings;
    const partial = { ...posting, complete: false };
    expect(await postingDetails("JSEARCH", ninja, partial)).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, description: "" })).toBe(posting.description);
    expect(await postingDetails("JSEARCH", ninja, { ...partial, externalId: "other", description: "" })).toBeNull();
  });
});

describe("testSource", () => {
  it("passes when the source answers", async () => {
    stubFetch(() => json(jsearchV2LastPage));
    await expect(testSource("JSEARCH", ninja)).resolves.toBeUndefined();
  });

  it("throws the problem when it doesn't", async () => {
    stubFetch(() => json({}, { status: 401 }));
    await expect(testSource("JSEARCH", ninja)).rejects.toMatchObject({ problem: "key" });
  });
});
