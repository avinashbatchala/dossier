import { describe, expect, it } from "vitest";

import { cached, CACHE_TTL_MS, clearJobSearchCache, remember } from "./cache";
import { countryCodeFor, countryName, COUNTRIES } from "./countries";
import { jobSearchError } from "./errors";
import {
  defaultSearch,
  EMPTY_QUERY,
  foundPostingSchema,
  latestRole,
  linkKey,
  postedAgo,
  postingKey,
  postingText,
  queryFromParams,
  safeLink,
  searchArea,
  searchHref,
  searchQuerySchema,
  viewFromParams,
  viewHref,
} from "./search";

describe("search in the URL", () => {
  it("round-trips a search", () => {
    const query = { keywords: "product designer", place: "Hamburg", country: "de", radiusKm: 50 as const, remoteOnly: true, postedWithin: "week" as const };
    const href = searchHref(query);
    expect(href).toBe("/jobs?q=product+designer&where=Hamburg&country=de&radius=50&remote=1&posted=week");
    expect(queryFromParams(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(query);
  });

  it("leaves defaults out of the URL", () => {
    expect(searchHref({ ...EMPTY_QUERY, keywords: "nurse" })).toBe("/jobs?q=nurse");
  });

  it("reads the view from the URL (E14-7)", () => {
    expect(viewFromParams({ view: "saved" })).toBe("saved");
    expect(viewFromParams({ view: "dismissed" })).toBe("dismissed");
    expect(viewFromParams({ view: "other" })).toBe("search");
    expect(viewFromParams({})).toBe("search");
    expect(viewHref("saved")).toBe("/jobs?view=saved");
  });

  it("has no search without keywords", () => {
    expect(queryFromParams({})).toBeNull();
    expect(queryFromParams({ q: "  ", where: "Berlin" })).toBeNull();
  });

  it("falls back to defaults for values it doesn't know", () => {
    expect(queryFromParams({ q: ["designer", "other"], radius: "33", posted: "year", country: "Germany", remote: "yes" })).toEqual({
      ...EMPTY_QUERY,
      keywords: "designer",
    });
  });

  it("validates a search from the screen", () => {
    expect(searchQuerySchema.parse({ ...EMPTY_QUERY, keywords: " designer ", country: "DE" })).toMatchObject({ keywords: "designer", country: "de" });
    expect(searchQuerySchema.safeParse({ ...EMPTY_QUERY, radiusKm: 30 }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ ...EMPTY_QUERY, country: "deu" }).success).toBe(false);
  });
});

describe("postings", () => {
  const posting = {
    source: "JSEARCH" as const,
    externalId: "abc",
    title: "UX Researcher",
    company: "Northwind Studio",
    place: "Berlin",
    remote: true,
    salary: "EUR 60,000 a year",
    postedAt: null,
    url: "https://jobs.example/1",
    via: "Indeed",
    description: "  We're looking for a researcher.  ",
    complete: true,
  };

  it("lays a posting out as New application gets it", () => {
    expect(postingText(posting)).toBe("Northwind Studio: UX Researcher\n\nBerlin · Remote · EUR 60,000 a year\n\nWe're looking for a researcher.");
    expect(postingText({ ...posting, company: "", place: "", remote: false, salary: "" })).toBe("UX Researcher\n\nWe're looking for a researcher.");
  });

  it("keys postings by source and id", () => {
    expect(postingKey(posting)).toBe("JSEARCH:abc");
  });

  it("checks postings sent back from the screen", () => {
    expect(foundPostingSchema.parse(posting)).toEqual(posting);
    expect(foundPostingSchema.parse({ ...posting, url: "" }).url).toBe("");
    expect(foundPostingSchema.safeParse({ ...posting, source: "MONSTER" }).success).toBe(false);
    expect(foundPostingSchema.safeParse({ ...posting, url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("picks the role to search for first", () => {
    const role = (name: string, span: Partial<{ current: boolean; startYear: number; endYear: number; endMonth: number }>) => ({
      role: name,
      current: false,
      startYear: null,
      startMonth: null,
      endYear: null,
      endMonth: null,
      ...span,
    });
    expect(latestRole([role("Designer", { startYear: 2018, endYear: 2021 }), role("Lead Designer", { current: true, startYear: 2021 })])).toBe("Lead Designer");
    expect(latestRole([role("Junior", { endYear: 2019, endMonth: 3 }), role("Senior", { endYear: 2019, endMonth: 9 }), role(" ", { current: true })])).toBe("Senior");
    expect(latestRole([role("Older", { startYear: 2010 }), role("Newer", { startYear: 2015 })])).toBe("Newer");
    expect(latestRole([])).toBe("");
  });

  it("starts the first search from the profile, anywhere in its country", () => {
    expect(defaultSearch({ role: " Product Designer ", country: "Deutschland" })).toEqual({
      ...EMPTY_QUERY,
      keywords: "Product Designer",
      country: "de",
    });
    expect(defaultSearch({ role: "", country: "" })).toEqual(EMPTY_QUERY);
  });

  it("says where a search looks", () => {
    expect(searchArea({ place: "Hamburg", radiusKm: 25 })).toBe("within 25 km of Hamburg");
    expect(searchArea({ place: " ", radiusKm: 25 }, "Germany")).toBe("anywhere in Germany");
    expect(searchArea({ place: "", radiusKm: 25 }, "Netherlands")).toBe("anywhere in Netherlands");
    expect(searchArea({ place: "", radiusKm: 25 })).toBe("anywhere");
  });

  it("says how long ago a posting went up", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(postedAgo(null, now)).toBe("");
    expect(postedAgo("2026-10-03T01:00:00Z", now)).toBe("Today");
    expect(postedAgo("2026-10-04T01:00:00Z", now)).toBe("Today");
    expect(postedAgo("2026-10-02T23:00:00Z", now)).toBe("Yesterday");
    expect(postedAgo("2026-09-28T00:00:00Z", now)).toBe("5 days ago");
    expect(postedAgo("2026-09-24T00:00:00Z", now)).toBe("1 week ago");
    expect(postedAgo("2026-09-10T00:00:00Z", now)).toBe("3 weeks ago");
    expect(postedAgo("2026-08-01T00:00:00Z", now)).toBe("1 Aug");
    expect(postedAgo("2025-08-01T00:00:00Z", now)).toBe("1 Aug 2025");
  });

  it("reduces links to what identifies the page", () => {
    expect(linkKey("https://www.linkedin.com/jobs/view/123/?trackingId=abc&refId=x&utm_source=google")).toBe("linkedin.com/jobs/view/123");
    expect(linkKey("https://de.indeed.com/viewjob?from=serp&jk=abc123")).toBe("de.indeed.com/viewjob?jk=abc123");
    expect(linkKey("https://jobs.example/a?b=2&a=1#apply")).toBe("jobs.example/a?a=1&b=2");
    expect(linkKey("not a link")).toBe("");
  });

  it("keeps only web links", () => {
    expect(safeLink(" https://jobs.example/a?b=1 ")).toBe("https://jobs.example/a?b=1");
    expect(safeLink("http://jobs.example")).toBe("http://jobs.example/");
    expect(safeLink("javascript:alert(1)")).toBe("");
    expect(safeLink("not a link")).toBe("");
    expect(safeLink(null)).toBe("");
  });
});

describe("countries", () => {
  it("names countries in English", () => {
    expect(countryName("de")).toBe("Germany");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("")).toBe("");
    expect(COUNTRIES.find((country) => country.code === "at")?.name).toBe("Austria");
    expect(COUNTRIES[0].name.localeCompare(COUNTRIES[1].name)).toBeLessThan(0);
  });

  it.each([
    ["Germany", "de"],
    ["Deutschland", "de"],
    ["  österreich ", "at"],
    ["DE", "de"],
    ["USA", "us"],
    ["United States", "us"],
    ["UK", "gb"],
    ["The Netherlands", "nl"],
    ["Schweiz", "ch"],
    ["Atlantis", ""],
    ["", ""],
  ])("matches %j to %j", (text, code) => {
    expect(countryCodeFor(text)).toBe(code);
  });
});

describe("errors", () => {
  it("words each problem for the screen", () => {
    expect(jobSearchError("no-key", "ADZUNA").message).toBe("Add your Adzuna app ID and key in Settings → Job search first.");
    expect(jobSearchError("no-key", "JSEARCH").message).toBe("Add your JSearch key in Settings → Job search first.");
    expect(jobSearchError("quota", "JSEARCH").message).toBe("You've used up your JSearch searches for this month. Try again then, or move to a bigger plan.");
    expect(jobSearchError("quota", "ARBEITSAGENTUR").message).toBe("Bundesagentur für Arbeit is limiting searches right now. Wait a minute and try again.");
    expect(jobSearchError("country", "ADZUNA", { country: "jp" }).message).toBe(
      "Adzuna doesn't list jobs in Japan. Choose another country, or another source in Settings → Job search.",
    );
    expect(jobSearchError("changed", "ARBEITSAGENTUR").message).toMatch(/^The Arbeitsagentur's job search has changed/);
    expect(jobSearchError("key", "JSEARCH", { detail: "HTTP 401" }).detail).toBe("JSEARCH: HTTP 401");
  });
});

describe("cache", () => {
  it("keeps answers for half an hour", () => {
    clearJobSearchCache();
    remember("a", { page: 1 }, 1000);
    expect(cached("a", 1000 + CACHE_TTL_MS - 1)).toEqual({ page: 1 });
    expect(cached("a", 1000 + CACHE_TTL_MS)).toBeUndefined();
    expect(cached("a", 1000)).toBeUndefined();
  });

  it("drops the oldest answers past 200", () => {
    clearJobSearchCache();
    for (let index = 0; index < 201; index++) remember(`k${index}`, index, 0);
    expect(cached("k0", 1)).toBeUndefined();
    expect(cached("k1", 1)).toBe(1);
    expect(cached("k200", 1)).toBe(200);
  });
});
