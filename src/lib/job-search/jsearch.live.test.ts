import { describe, expect, it } from "vitest";

import { jsearch } from "./jsearch";
import { EMPTY_QUERY } from "./search";

// Checks against the real JSearch API, skipped unless asked for. Each run
// spends two searches from the plan:
//
//   JOBS_LIVE=jsearch JSEARCH_TEST_KEY=… docker/bin/yarn vitest run src/lib/job-search/jsearch.live.test.ts
//
// JSEARCH_TEST_HOST=rapidapi checks a RapidAPI key instead.

const live = new Set((process.env.JOBS_LIVE ?? "").split(",").map((name) => name.trim()));
const key = process.env.JSEARCH_TEST_KEY ?? "";
const host = process.env.JSEARCH_TEST_HOST === "rapidapi" ? "rapidapi" : "openwebninja";

// Two searches, each of which may take up to JSEARCH_TIMEOUT_MS.
describe.runIf(live.has("jsearch") && key)("JSearch (live)", { timeout: 100_000 }, () => {
  it("finds postings near a place, with their text and a link, and a second page", async () => {
    const query = { ...EMPTY_QUERY, keywords: "software developer", place: "Hamburg", country: "de", radiusKm: 50 as const };
    const page = await jsearch.search(query, { key, host }, null);
    expect(page.postings.length).toBeGreaterThan(0);
    for (const posting of page.postings) {
      expect(posting.title).not.toBe("");
      expect(posting.url).toMatch(/^https?:\/\//);
    }
    expect(page.postings.some((posting) => posting.complete)).toBe(true);
    expect(page.next).not.toBeNull();

    const next = await jsearch.search(query, { key, host }, page.next);
    expect(next.postings.length).toBeGreaterThan(0);
  });
});
