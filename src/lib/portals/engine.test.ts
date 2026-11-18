import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, refused, stubFetch } from "@/lib/ai/test-http";
import { clearJobSearchCache } from "@/lib/job-search/cache";
import { JobSearchError } from "@/lib/job-search/errors";
import { EMPTY_QUERY, type SearchQuery } from "@/lib/job-search/search";

import { portalAdapter } from "./engine";
import { portalConfigSchema } from "./format";
import { boardsSample, feedSample, jobPostingSample, jsonSample } from "./samples.test-data";

vi.mock("@/lib/posting-fetch", () => ({ fetchPosting: vi.fn(async (url: string) => ({ ok: true, text: `Page text of ${url}`, source: "page", url })) }));

const board = portalAdapter(portalConfigSchema.parse(jsonSample));
const feed = portalAdapter(portalConfigSchema.parse(feedSample));
const careers = portalAdapter(portalConfigSchema.parse(jobPostingSample));
const query: SearchQuery = { ...EMPTY_QUERY, keywords: "ux designer", place: "Hamburg", country: "de", radiusKm: 50, postedWithin: "week" };
const fields = { key: "sk_test" };

const answer = {
  meta: { count: 3 },
  results: [
    {
      id: 17,
      title: "UX Designer",
      employer: { name: "Northwind" },
      location: { city: "Hamburg", region: "HH" },
      workplace: "remote",
      pay: { from: 60000, to: 75000.4, per: "YEAR" },
      published: "2026-11-10T08:00:00Z",
      link: "https://sample.example/jobs/17",
      text: "<p>Design <b>things</b>.</p>",
    },
    { id: 17, title: "The same one again" },
    { title: "No id" },
    { id: "x-2", title: "Researcher", workplace: "elsewhere", link: "javascript:alert(1)" },
  ],
};

const text = (body: string, type: string) => new Response(body, { headers: { "content-type": type } });
const problem = async (work: Promise<unknown>) => {
  const error = await work.catch((caught: unknown) => caught);
  return error instanceof JobSearchError ? [error.problem, error.message] : error;
};

beforeEach(() => (vi.unstubAllGlobals(), clearJobSearchCache()));
afterEach(() => vi.unstubAllGlobals());

describe("a JSON portal", () => {
  it("asks with the query, the fields and the page, leaving out what's empty or doesn't apply", async () => {
    const requests = stubFetch(() => json(answer));
    await board.search({ ...query, experience: "lead" }, fields, null);
    const [{ url, headers }] = requests;
    expect(`${url.origin}${url.pathname}`).toBe("https://api.sample.example/v2/de/jobs");
    expect(headers.get("authorization")).toBe("Bearer sk_test");
    expect([...url.searchParams]).toEqual([
      ["q", "ux designer"],
      ["where", "Hamburg"],
      ["km", "50"],
      ["days", "7"],
      ["senior", "1"],
      ["page", "1"],
    ]);

    await board.search({ ...query, place: "", remoteOnly: true, postedWithin: "any" }, fields, "page:2");
    expect([...requests[1].url.searchParams]).toEqual([
      ["q", "ux designer"],
      ["q", "remote"],
      ["page", "2"],
    ]);
  });

  it("reads each posting, once, and skips one without an id", async () => {
    stubFetch(() => json(answer));
    const page = await board.search(query, fields, null);
    expect(page.postings).toEqual([
      {
        source: "SAMPLE_JSON",
        externalId: "17",
        title: "UX Designer",
        company: "Northwind",
        place: "Hamburg, HH",
        remote: true,
        salary: "EUR 60,000–75,000 a year",
        postedAt: "2026-11-10T08:00:00.000Z",
        url: "https://sample.example/jobs/17",
        via: "",
        description: "Design things.",
        complete: true,
      },
      expect.objectContaining({ externalId: "x-2", remote: null, url: "", salary: "", complete: false }),
    ]);
    // 2 a page of 3: one more page.
    expect(page.next).toBe("page:2");
  });

  it("stops paging at the total", async () => {
    stubFetch(() => json(answer));
    expect((await board.search(query, fields, "page:2")).next).toBeNull();
  });

  it("says what went wrong in words, with the portal's own name and quota", async () => {
    stubFetch(() => json({}, { status: 401 }));
    expect(await problem(board.search(query, fields, null))).toEqual(["key", "Sample Board didn't accept your key. Check it in Settings → Job search."]);
    stubFetch(() => json({}, { status: 429 }));
    expect(await problem(board.search(query, fields, null))).toEqual(["quota", expect.stringContaining("for today")]);
    stubFetch(() => json({ error: "maintenance" }));
    expect(await problem(board.search(query, fields, null))).toEqual(["changed", expect.stringContaining("Sample Board answered in a way")]);
    stubFetch(() => text("<html>", "text/html"));
    expect(await problem(board.search(query, fields, null))).toEqual(["changed", expect.any(String)]);
    stubFetch(refused);
    expect(await problem(board.search(query, fields, null))).toEqual(["unavailable", expect.any(String)]);
  });

  it("goes nowhere but its hosts, not even by a redirect", async () => {
    const requests = stubFetch(() => new Response(null, { status: 302, headers: { location: "https://collector.example/steal" } }));
    expect(await problem(board.search(query, fields, null))).toEqual(["changed", expect.any(String)]);
    expect(requests.map(({ url }) => url.hostname)).toEqual(["api.sample.example"]);

    const moved = stubFetch((request) => (request.url.pathname.endsWith("/jobs") ? new Response(null, { status: 301, headers: { location: "/v2/de/jobs/" } }) : json(answer)));
    expect((await board.search(query, fields, null)).postings).toHaveLength(2);
    expect(moved.map(({ url }) => url.pathname)).toEqual(["/v2/de/jobs", "/v2/de/jobs/"]);
  });

  it("goes to the tests' address instead, over http too", async () => {
    const requests = stubFetch(() => json(answer));
    await board.search(query, fields, null, { baseUrl: "http://localhost:3999/sample" });
    expect(`${requests[0].url.origin}${requests[0].url.pathname}`).toBe("http://localhost:3999/sample/de/jobs");
  });

  it("tests the connection with its own small search", async () => {
    const requests = stubFetch(() => json(answer));
    await board.test(fields);
    expect(requests[0].url.searchParams.get("q")).toBe("developer");
  });
});

describe("a feed", () => {
  const rss = `<rss><channel>
    <item><guid>g1</guid><title>Senior UX Designer</title><author>Acme</author><link>https://feeds.sample.example/1</link><pubDate>Wed, 12 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Remote design work</p>]]></description></item>
    <item><guid>g2</guid><title>Backend Engineer</title><link>https://feeds.sample.example/2</link><pubDate>Wed, 12 Nov 2026 10:00:00 GMT</pubDate></item>
    <item><guid>g3</guid><title>UX Designer</title><link>https://feeds.sample.example/3</link><pubDate>Mon, 01 Sep 2025 10:00:00 GMT</pubDate></item>
  </channel></rss>`;

  it("keeps the postings that fit the search, since the feed lists everything", async () => {
    stubFetch(() => text(rss, "application/rss+xml"));
    const page = await feed.search({ ...query, place: "", remoteOnly: true }, {}, null, { now: new Date("2026-11-14T00:00:00Z") });
    expect(page.postings.map((posting) => posting.externalId)).toEqual(["g1"]);
    expect(page.postings[0]).toMatchObject({ company: "Acme", remote: true, description: "Remote design work", complete: true, postedAt: "2026-11-12T10:00:00.000Z" });
    expect(page.next).toBeNull();
  });

  it("downloads a kept feed once for every search until it's due again, sharing one download", async () => {
    const kept = portalAdapter(portalConfigSchema.parse({ ...feedSample, search: { ...feedSample.search, keepMinutes: 60 } }));
    const requests = stubFetch(() => text(rss, "application/rss+xml"));
    const now = new Date("2026-11-14T00:00:00Z");
    await Promise.all([kept.search({ ...query, place: "" }, {}, null, { now }), kept.search({ ...query, place: "", keywords: "engineer" }, {}, null, { now })]);
    const later = await kept.search({ ...query, place: "", keywords: "designer" }, {}, null, { now });
    expect(requests).toHaveLength(1);
    expect(later.postings.map((posting) => posting.externalId)).toEqual(["g1"]);
    clearJobSearchCache();
    await kept.search({ ...query, place: "" }, {}, null, { now });
    expect(requests).toHaveLength(2);
  });

  it("keeps a posting only where it can be done from, and matches the words in the title or company", async () => {
    stubFetch(() =>
      text(
        `<rss><channel>
          <item><guid>us</guid><title>UX Designer</title><category>USA only</category><description>Design</description></item>
          <item><guid>eu</guid><title>UX Designer</title><category>Europe</category><description>Design</description></item>
          <item><guid>text</guid><title>Researcher</title><description>Works with a UX designer</description></item>
        </channel></rss>`,
        "application/rss+xml",
      ),
    );
    const placed = portalAdapter(portalConfigSchema.parse({ ...feedSample, search: { ...feedSample.search, posting: { ...feedSample.search.posting, place: "category" } } }));
    expect((await placed.search({ ...query, place: "", postedWithin: "any" }, {}, null)).postings.map((posting) => posting.externalId)).toEqual(["eu"]);
  });

  it("refuses a feed that isn't one", async () => {
    stubFetch(() => text("just text", "text/plain"));
    expect(await problem(feed.search(query, {}, null))).toEqual(["changed", expect.any(String)]);
  });

  it("has the whole posting already, or nothing more to fetch", async () => {
    const posting = { ...(await (async () => (stubFetch(() => text(rss, "application/rss+xml")), feed.search({ ...query, place: "" }, {}, null, { now: new Date("2026-11-14T00:00:00Z") })))()).postings[0] };
    expect(await feed.details(posting, {})).toBe("Remote design work");
    expect(await feed.details({ ...posting, description: "" }, {})).toBeNull();
  });
});

describe("a page with JobPosting data", () => {
  const page = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Acme"},
      {"@type":"JobPosting","identifier":{"@type":"PropertyValue","value":"eng-1"},"title":"Platform Engineer","hiringOrganization":{"name":"Acme"},
       "jobLocation":{"address":{"addressLocality":"Berlin"}},"datePosted":"2026-11-01","description":"<p>Build it.</p>","url":"https://careers.sample.example/eng-1",
       "baseSalary":{"currency":"EUR","value":{"minValue":70000,"maxValue":90000,"unitText":"YEAR"}}}]}</script>
    <script type="application/ld+json">[{"@type":"JobPosting","url":"https://careers.sample.example/eng-2","title":"Support Engineer","jobLocationType":"TELECOMMUTE","description":"Help."},{"@type":"JobPosting","title":"Office Manager","url":"https://careers.sample.example/om"}]</script>
    <script type="application/ld+json">{ broken</script>
  </head></html>`;

  it("reads every JobPosting, with the standard mapping, and keeps the ones that fit", async () => {
    stubFetch(() => text(page, "text/html"));
    const found = await careers.search({ ...EMPTY_QUERY, keywords: "engineer", country: "de" }, {}, null);
    expect(found.postings).toEqual([
      expect.objectContaining({ source: "SAMPLE_CAREERS", externalId: "eng-1", company: "Acme", place: "Berlin", salary: "EUR 70,000–90,000 a year", description: "Build it.", complete: true }),
      expect.objectContaining({ externalId: "https://careers.sample.example/eng-2", remote: true }),
    ]);
  });
});

describe("details by request", () => {
  const withDetails = portalAdapter(
    portalConfigSchema.parse({
      ...jsonSample,
      details: { type: "request", url: "{base}/jobs/{id|base64|raw}", headers: { Authorization: "Bearer {fields.key}" }, description: { path: "full", clean: "markdown" }, thenPage: true },
    }),
  );
  const posting = { source: "SAMPLE_JSON", externalId: "10000-1", title: "", company: "", place: "", remote: null, salary: "", postedAt: null, url: "https://sample.example/jobs/1", via: "", description: "", complete: false };

  it("asks for the one posting, and reads its description", async () => {
    const requests = stubFetch(() => json({ full: "**Hello**\r\n\r\n\r\n- there" }));
    expect(await withDetails.details(posting, fields)).toBe("Hello\n\n- there");
    expect(requests[0].url.pathname).toBe("/v2/jobs/MTAwMDAtMQ==");
    expect(requests[0].headers.get("authorization")).toBe("Bearer sk_test");
  });

  it("falls back to the posting's page", async () => {
    stubFetch(() => json({}, { status: 500 }));
    expect(await withDetails.details(posting, fields)).toBe("Page text of https://sample.example/jobs/1");
  });
});

describe("a search for each board in a list", () => {
  const boards = portalAdapter(portalConfigSchema.parse(boardsSample));
  const jobs = (...list: object[]) => json({ jobs: list });
  const route = ({ url }: { url: URL }) =>
    url.pathname === "/acme/jobs"
      ? jobs({ id: 1, title: "Software Engineer", location: "Remote - USA", url: "https://boards.sample.example/acme/1", text: "Build" })
      : url.pathname === "/globex-corp/jobs"
        ? jobs({ id: 2, title: "Platform Engineer", location: "Berlin, Germany", url: "https://boards.sample.example/globex-corp/2", text: "Run" }, { id: 3, title: "Designer", location: "Berlin" })
        : json({ error: "not found" }, { status: 404 });
  const germany: SearchQuery = { ...EMPTY_QUERY, keywords: "engineer", country: "de" };

  it("asks each board, a few at a time and up to the field's limit, and names the ones it couldn't read", async () => {
    const requests = stubFetch(route);
    const page = await boards.search(germany, { boards: "acme\nhttps://boards.sample.example/globex-corp\nnope\nfourth" }, null);
    expect(requests.map((request) => request.url.pathname).sort()).toEqual(["/acme/jobs", "/globex-corp/jobs", "/nope/jobs"]);
    // Acme's posting is for the USA only; Globex's designer isn't an engineer.
    expect(page.postings).toEqual([expect.objectContaining({ externalId: "2", company: "Globex Corp", place: "Berlin, Germany", complete: true })]);
    expect(page).toMatchObject({ next: null, note: "Couldn't read nope." });
  });

  it("says the names are wrong when no board can be read, and that the portal is down when it is", async () => {
    stubFetch(route);
    expect(await problem(boards.search(germany, { boards: "nope\nnada" }, null))).toEqual(["key", "Sample Boards couldn't read nope and nada. Check them in Settings → Job search."]);
    stubFetch(() => json({}, { status: 503 }));
    expect(await problem(boards.search(germany, { boards: "acme" }, null))).toEqual(["unavailable", expect.stringContaining("isn't answering")]);
    expect(await problem(boards.search(germany, { boards: "" }, null))).toEqual(["no-key", "Add your Sample Boards boards in Settings → Job search first."]);
  });

  it("tests every board, naming the ones that don't work", async () => {
    stubFetch(route);
    await expect(boards.test({ boards: "acme\nglobex-corp" })).resolves.toBeUndefined();
    expect(await problem(boards.test({ boards: "acme\nnope" }))).toEqual(["key", "Sample Boards couldn't read nope. Check it; the rest work."]);
  });

  it("reads an answer up to its own size limit", async () => {
    const big = "x".repeat(6 * 1024 * 1024);
    stubFetch(() => jobs({ id: 9, title: "Engineer", text: big }));
    expect((await boards.search({ ...germany, country: "" }, { boards: "acme" }, null)).postings).toHaveLength(1);
    stubFetch(() => json({ results: [{ id: 9, title: big }] }));
    expect(await problem(board.search(query, fields, null))).toEqual(["changed", expect.any(String)]);
  });
});
