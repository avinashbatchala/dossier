import { describe, expect, it } from "vitest";

import { adzuna } from "./adzuna";
import { arbeitsagentur } from "./arbeitsagentur";
import { requestContext } from "./config";
import { freehire } from "./freehire";
import { EMPTY_QUERY } from "./search";

// Checks against the real Adzuna, Arbeitsagentur and FreeHire services,
// skipped unless asked for. The Arbeitsagentur and FreeHire need no key;
// Adzuna spends two calls from the day's allowance:
//
//   JOBS_LIVE=arbeitsagentur docker/bin/yarn vitest run src/lib/job-search/sources.live.test.ts
//   JOBS_LIVE=adzuna ADZUNA_TEST_APP_ID=… ADZUNA_TEST_KEY=… docker/bin/yarn vitest run src/lib/job-search/sources.live.test.ts
//   JOBS_LIVE=freehire docker/bin/yarn vitest run src/lib/job-search/sources.live.test.ts
//
// FreeHire's is freehire.me, or the self-hosted one DOSSIER_FREEHIRE_URL
// names, on the command line or in `.env`.

const live = new Set((process.env.JOBS_LIVE ?? "").split(",").map((name) => name.trim()));
const adzunaKey = { appId: process.env.ADZUNA_TEST_APP_ID ?? "", key: process.env.ADZUNA_TEST_KEY ?? "" };
const query = { ...EMPTY_QUERY, keywords: "Softwareentwickler", place: "Hamburg", country: "de", radiusKm: 25 as const };

/** Where the app sends FreeHire's searches, with `.env` read as the app reads it, so DOSSIER_FREEHIRE_URL there counts. */
function freehireContext() {
  // Keeps what's set already, such as the DATABASE_URL Compose gives the container.
  process.loadEnvFile(".env");
  return requestContext("FREEHIRE");
}

describe.runIf(live.has("arbeitsagentur"))("Arbeitsagentur (live)", { timeout: 30_000 }, () => {
  it("finds postings near a place, a second page, and the whole text of one", async () => {
    const page = await arbeitsagentur.search(query, {}, null);
    expect(page.postings.length).toBeGreaterThan(0);
    expect(page.postings.every((posting) => posting.title && posting.url.startsWith("https://"))).toBe(true);
    expect(page.next).toBe("page:2");
    expect((await arbeitsagentur.search(query, {}, page.next)).postings.length).toBeGreaterThan(0);
    expect((await arbeitsagentur.details(page.postings[0], {}))?.length).toBeGreaterThan(100);
  });
});

describe.runIf(live.has("adzuna") && adzunaKey.appId && adzunaKey.key)("Adzuna (live)", { timeout: 30_000 }, () => {
  it("finds postings near a place, and a second page", async () => {
    const page = await adzuna.search({ ...query, keywords: "software developer" }, adzunaKey, null);
    expect(page.postings.length).toBeGreaterThan(0);
    expect(page.postings.every((posting) => posting.title && !posting.complete)).toBe(true);
    expect((await adzuna.search({ ...query, keywords: "software developer" }, adzunaKey, page.next)).postings.length).toBeGreaterThan(0);
  });
});

describe.runIf(live.has("freehire"))("FreeHire (live)", { timeout: 30_000 }, () => {
  it("finds postings, with their text and a link, and a second page", async () => {
    const context = freehireContext();
    const page = await freehire.search({ ...query, keywords: "software engineer", place: "" }, {}, null, context);
    expect(page.postings.length).toBeGreaterThan(0);
    for (const posting of page.postings) {
      expect(posting.title).not.toBe("");
      expect(posting.url).toMatch(/^https?:\/\//);
    }
    expect(page.postings.some((posting) => posting.complete)).toBe(true);
    expect(page.next).not.toBeNull();
    expect((await freehire.search({ ...query, keywords: "software engineer", place: "" }, {}, page.next, context)).postings.length).toBeGreaterThan(0);
  });

  it("keeps to the past week when asked", async () => {
    const { postings } = await freehire.search({ ...query, keywords: "software engineer", place: "", postedWithin: "week" }, {}, null, freehireContext());
    expect(postings.length).toBeGreaterThan(0);
    const weekAgo = Date.now() - 8 * 86_400_000;
    expect(postings.every((posting) => posting.postedAt !== null && Date.parse(posting.postedAt) > weekAgo)).toBe(true);
  });
});
