import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, refused, stubFetch } from "@/lib/ai/test-http";
import { jsearchKeyError, jsearchV2LastPage, jsearchV2Page } from "@/test/job-search-fixtures";

import { JobSearchError } from "./errors";
import { jsearch } from "./jsearch";
import { EMPTY_QUERY, type SearchQuery } from "./search";

const query: SearchQuery = { ...EMPTY_QUERY, keywords: "product designer", place: "Hamburg", country: "de", radiusKm: 50, postedWithin: "week" };
const ninja = { key: "ak_test", host: "openwebninja" as const };
const rapid = { key: "rapid-test", host: "rapidapi" as const };

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("JSearch search", () => {
  it("asks OpenWeb Ninja's search-v2 with the key, place, country, radius and recency", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    await jsearch.search(query, ninja, null);
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://api.openwebninja.com/jsearch/search-v2");
    expect(headers.get("x-api-key")).toBe("ak_test");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "product designer in Hamburg",
      country: "de",
      date_posted: "week",
      radius: "50",
    });
  });

  it("asks RapidAPI's search-v2 with its own headers, and pages by cursor", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const page = await jsearch.search({ ...query, place: "", remoteOnly: true, postedWithin: "any" }, rapid, null);
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://jsearch.p.rapidapi.com/search-v2");
    expect(headers.get("x-rapidapi-key")).toBe("rapid-test");
    expect(headers.get("x-rapidapi-host")).toBe("jsearch.p.rapidapi.com");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "product designer",
      country: "de",
      date_posted: "all",
      work_from_home: "true",
    });
    expect(page.next).toBe("cursor:CURSOR-PAGE-2");
    expect(page.postings).toHaveLength(2);
  });

  it("searches the US when no country is chosen, as JSearch would anyway", async () => {
    const requests = stubFetch(() => json(jsearchV2LastPage));
    await jsearch.search({ ...query, country: "" }, ninja, null);
    expect(requests[0].url.searchParams.get("country")).toBe("us");
  });

  it("maps postings to the shared shape, once each, preferring the employer's own link", async () => {
    stubFetch(() => json(jsearchV2Page));
    const page = await jsearch.search(query, ninja, null);
    expect(page.next).toBe("cursor:CURSOR-PAGE-2");
    expect(page.postings).toEqual([
      {
        source: "JSEARCH",
        externalId: "aG9tZWQtZGVzaWduZXItbGVkZ2VybHk=",
        title: "Senior Product Designer, Payments",
        company: "Ledgerly",
        place: "Hamburg",
        remote: false,
        salary: "EUR 75,000–90,000 a year",
        postedAt: "2026-09-30T08:00:00.000Z",
        url: "https://careers.ledgerly.example/jobs/42",
        via: "LinkedIn",
        description: expect.stringContaining("Senior Product Designer for its payments team"),
        complete: true,
      },
      {
        source: "JSEARCH",
        externalId: "bm9ydGh3aW5kLXV4LXJlc2VhcmNo",
        title: "UX Researcher",
        company: "Northwind Studio",
        place: "Berlin, Germany",
        remote: true,
        salary: "",
        postedAt: new Date(1790582400 * 1000).toISOString(),
        url: "https://de.indeed.com/viewjob?jk=abc123&from=serp",
        via: "Indeed",
        description: "Northwind Studio is looking for a UX Researcher, fully remote within Germany.",
        complete: true,
      },
    ]);
  });

  it("sends the cursor for the next page and stops when there's none", async () => {
    const requests = stubFetch(() => json(jsearchV2LastPage));
    const page = await jsearch.search(query, ninja, "cursor:CURSOR-PAGE-2");
    expect(requests[0].url.searchParams.get("cursor")).toBe("CURSOR-PAGE-2");
    expect(requests[0].url.searchParams.has("page")).toBe(false);
    expect(page.next).toBeNull();
  });

  it("starts over on a page number from RapidAPI's old search", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const page = await jsearch.search(query, rapid, "page:3");
    expect(["page", "num_pages", "cursor"].filter((name) => requests[0].url.searchParams.has(name))).toEqual([]);
    expect(page.next).toBe("cursor:CURSOR-PAGE-2");
  });

  it("says the source changed when it answers with a list, as the old search did", async () => {
    stubFetch(() => json({ data: [jsearchV2LastPage.data.jobs[0]] }));
    await expect(jsearch.search(query, rapid, null)).rejects.toMatchObject({
      problem: "changed",
      detail: "JSEARCH: /search-v2: unexpected answer (keys: data)",
    });
  });

  it("goes to the fake source's address when one is given", async () => {
    const requests = stubFetch(() => json(jsearchV2LastPage));
    await jsearch.search(query, ninja, null, { baseUrl: "http://127.0.0.1:3998/jsearch" });
    expect(requests[0].url.href).toMatch(/^http:\/\/127\.0\.0\.1:3998\/jsearch\/search-v2\?/);
  });

  it("drops links that aren't web addresses, and reads salaries written as text", async () => {
    stubFetch(() =>
      json({
        data: {
          jobs: [
            {
              job_id: "x",
              job_title: "Designer",
              job_apply_link: "javascript:alert(1)",
              apply_options: [{ apply_link: "data:text/html,hi", is_direct: true }],
              job_salary: "€60K–€70K a year",
              job_min_salary: 1,
            },
            { job_id: "y", job_min_salary: 50, job_max_salary: 50, job_salary_period: "hour", job_salary_currency: "USD", job_description: "" },
            { job_id: "z", job_salary: null, job_salary_string: "40.000–50.000 € im Jahr", job_location: "Beliebiger Ort   •  über Indeed" },
          ],
          cursor: null,
        },
      }),
    );
    const [first, second, third] = (await jsearch.search(query, ninja, null)).postings;
    expect(third).toMatchObject({ salary: "40.000–50.000 € im Jahr", place: "Beliebiger Ort" });
    expect(first).toMatchObject({ url: "", salary: "€60K–€70K a year", remote: null, postedAt: null, via: "", complete: false });
    expect(second).toMatchObject({ salary: "USD 50 an hour", title: "", company: "", place: "" });
  });

  it.each([
    [401, "key"],
    [403, "key"],
    [429, "quota"],
    [503, "unavailable"],
    [404, "changed"],
  ] as const)("turns HTTP %i into a %s problem", async (status, problem) => {
    stubFetch(() => json(jsearchKeyError, { status }));
    await expect(jsearch.search(query, ninja, null)).rejects.toMatchObject({ name: "JobSearchError", problem });
  });

  it("says the source changed when the answer has an unknown shape", async () => {
    stubFetch(() => json({ data: { results: [] } }));
    const error = await jsearch.search(query, ninja, null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JobSearchError);
    expect(error).toMatchObject({ problem: "changed", detail: "JSEARCH: /jsearch/search-v2: unexpected answer (keys: data)" });
  });

  it("names the keys of an answer it can't read, never their values (#231)", async () => {
    stubFetch(() => json({ status: "ERROR", message: "Invalid query: product designer in Hamburg" }));
    await expect(jsearch.search(query, ninja, null)).rejects.toMatchObject({
      problem: "changed",
      detail: "JSEARCH: /jsearch/search-v2: unexpected answer (keys: status, message)",
    });
    stubFetch(() => json(["product designer in Hamburg"]));
    await expect(jsearch.search(query, ninja, null)).rejects.toMatchObject({ detail: "JSEARCH: /jsearch/search-v2: unexpected answer" });
  });

  it("gives a search 45 seconds, then says it isn't answering, as before (#231)", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    stubFetch((_, signal) => Promise.reject(signal?.reason ?? new Error("aborted")));
    await expect(jsearch.search(query, ninja, null)).rejects.toMatchObject({
      problem: "unavailable",
      message: "JSearch isn't answering right now. Try again in a minute.",
      detail: "JSEARCH: /jsearch/search-v2: timed out",
    });
    expect(timeout).toHaveBeenCalledWith(45_000);
  });

  it("says the source isn't answering when it can't be reached", async () => {
    stubFetch(refused);
    await expect(jsearch.search(query, ninja, null)).rejects.toMatchObject({
      problem: "unavailable",
      message: "JSearch isn't answering right now. Try again in a minute.",
      detail: "JSEARCH: /jsearch/search-v2: ECONNREFUSED",
    });
  });
});

describe("JSearch details and test", () => {
  it("has the whole description already, so details never asks again", async () => {
    const requests = stubFetch(() => json(jsearchV2Page));
    const [posting] = (await jsearch.search(query, ninja, null)).postings;
    expect(await jsearch.details(posting, ninja)).toBe(posting.description);
    expect(await jsearch.details({ ...posting, description: "" }, ninja)).toBeNull();
    expect(requests).toHaveLength(1);
  });

  it("tests the key with one small search, as patient as a search", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const requests = stubFetch(() => json(jsearchV2LastPage));
    await jsearch.test(ninja);
    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("query")).toBe("developer");
    expect(timeout).toHaveBeenCalledWith(45_000);
  });
});
