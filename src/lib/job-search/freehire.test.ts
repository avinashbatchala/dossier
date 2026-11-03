import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { freehireLastPage, freehirePage } from "@/test/job-search-fixtures";

import { freehire } from "./freehire";
import { EMPTY_QUERY } from "./search";

const fetchPosting = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posting-fetch", () => ({ fetchPosting }));

const query = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de", radiusKm: 50 as const, postedWithin: "week" as const };

afterEach(() => {
  vi.unstubAllGlobals();
  fetchPosting.mockReset();
});

describe("FreeHire search", () => {
  it("asks the agent search with plain text, country and place in q", async () => {
    const requests = stubFetch(() => json(freehirePage));
    await freehire.search(query, {}, null);
    const [{ url }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://freehire.me/api/v1/agent/jobs/search");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "product designer in Hamburg",
      description_format: "text",
      limit: "20",
      offset: "0",
      countries: "DE",
      posted_within_days: "7",
    });
  });

  it("sets work_mode when remote-only, and uses the test base URL", async () => {
    const requests = stubFetch(() => json(freehirePage));
    await freehire.search({ ...query, place: "", remoteOnly: true }, {}, "offset:20", { baseUrl: "http://127.0.0.1:3998/freehire" });
    const [{ url }] = requests;
    expect(url.href).toMatch(/^http:\/\/127\.0\.0\.1:3998\/freehire\/api\/v1\/agent\/jobs\/search\?/);
    expect(url.searchParams.get("q")).toBe("product designer");
    expect(url.searchParams.get("work_mode")).toBe("remote");
    expect(url.searchParams.get("offset")).toBe("20");
  });

  it("leaves the date out for any time", async () => {
    const requests = stubFetch(() => json(freehirePage));
    await freehire.search({ ...query, postedWithin: "any" }, {}, null);
    expect(requests[0].url.searchParams.has("posted_within_days")).toBe(false);
  });

  it("maps results to the shared shape, with full descriptions marked complete", async () => {
    stubFetch(() => json(freehirePage));
    const page = await freehire.search(query, {}, null);
    expect(page.next).toBe("offset:20");
    expect(page.postings).toEqual([
      {
        source: "FREEHIRE",
        externalId: "senior-go-engineer-acme-1a2b",
        title: "Senior Go Engineer",
        company: "Acme",
        place: "Remote — EU",
        remote: true,
        salary: "EUR 90,000–130,000 a year",
        postedAt: "2026-06-18T00:00:00.000Z",
        url: "https://boards.greenhouse.io/acme/jobs/123",
        via: "greenhouse",
        description: "Acme is hiring a Senior Go Engineer.\n\nYou'll build APIs.",
        complete: true,
      },
      {
        source: "FREEHIRE",
        externalId: "ux-researcher-northwind",
        title: "UX Researcher",
        company: "Northwind Studio",
        place: "Berlin",
        remote: false,
        salary: "",
        postedAt: null,
        url: "",
        via: "lever",
        description: "",
        complete: false,
      },
    ]);
  });

  it("stops at the last page", async () => {
    stubFetch(() => json(freehireLastPage));
    expect((await freehire.search(query, {}, "offset:20")).next).toBeNull();
    stubFetch(() => json({ data: [], meta: { total: 0, limit: 20, offset: 0 } }));
    expect((await freehire.search(query, {}, null)).next).toBeNull();
  });

  it("stops at its first 10,000 results, past which it answers nothing", async () => {
    stubFetch(() => json({ ...freehirePage, meta: { total: 50_000, limit: 20, offset: 9960 } }));
    expect((await freehire.search(query, {}, "offset:9960")).next).toBe("offset:9980");
    expect((await freehire.search(query, {}, "offset:9980")).next).toBeNull();
  });

  it("writes a salary without a range as one amount", async () => {
    stubFetch(() => json(freehireLastPage));
    const [posting] = (await freehire.search(query, {}, null)).postings;
    expect(posting.salary).toBe("EUR 52,000 a year");
    expect(posting.remote).toBeNull();
  });

  it("says the source changed when the answer has an unknown shape", async () => {
    stubFetch(() => json({ jobs: [] }));
    await expect(freehire.search(query, {}, null)).rejects.toMatchObject({ problem: "changed" });
  });

  it("says when FreeHire isn't answering", async () => {
    stubFetch(() => json({ error: "unavailable" }, { status: 503 }));
    await expect(freehire.search(query, {}, null)).rejects.toMatchObject({
      problem: "unavailable",
      message: "FreeHire isn't answering right now. Try again in a minute.",
    });
  });
});

describe("FreeHire details and test", () => {
  it("reads the page of a posting that came without its text", async () => {
    stubFetch(() => json(freehirePage));
    const [posting] = (await freehire.search(query, {}, null)).postings;
    const bare = { ...posting, description: "", complete: false };
    fetchPosting.mockResolvedValueOnce({ ok: true, text: "The whole posting.", source: "page", url: posting.url });
    expect(await freehire.details(bare, {})).toBe("The whole posting.");
    expect(fetchPosting).toHaveBeenCalledWith(posting.url);
    fetchPosting.mockResolvedValueOnce({ ok: false, error: "unreadable" });
    expect(await freehire.details(bare, {})).toBeNull();
    expect(await freehire.details({ ...bare, url: "" }, {})).toBeNull();
  });

  it("tests with one small search", async () => {
    const requests = stubFetch(() => json(freehirePage));
    await freehire.test({});
    expect(requests[0].url.pathname).toBe("/api/v1/agent/jobs/search");
    expect(requests[0].url.searchParams.get("q")).toBe("developer");
    expect(requests[0].url.searchParams.get("countries")).toBe("US");
  });
});
