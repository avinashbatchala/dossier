// A stand-in for the job sources (E14-9), started by playwright.config.ts.
// The app sends each source's requests to http://localhost:<port>/<source>
// (DOSSIER_JOBS_TEST_BASE_URL), and this answers in that source's own shape,
// so the adapters' real request and response handling runs end to end.

import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.FAKE_JOBS_PORT ?? 3998);
/** The JSearch key the app is given in e2e/support.ts. */
const JSEARCH_KEY = "e2e-jsearch-key";
// Equal fixture dates keep shared score-cap ordering stable even if creating
// the three postings straddles a millisecond boundary.
const postedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
/** The TypeSafe key a spec saves in Settings → Scoring (#274). */
const TYPESAFE_KEY = "e2e-typesafe-key";

const job = (id: string, title: string, company: string, extra: Record<string, unknown> = {}) => ({
  job_id: id,
  job_title: title,
  employer_name: company,
  job_publisher: "LinkedIn",
  job_apply_link: `https://jobs.example/${id}`,
  apply_options: [{ publisher: "LinkedIn", apply_link: `https://jobs.example/${id}`, is_direct: false }],
  job_description: `${company} is hiring a ${title}.\n\nWhat you'll do\n- Design checkout flows\n- Work with research\n\nWhat we're looking for\n- 5+ years of product design\n- Strong prototyping skills in Figma`,
  job_is_remote: false,
  job_posted_at_datetime_utc: postedAt,
  job_location: "Rotterdam  •  via LinkedIn",
  job_country: "NL",
  ...extra,
});

const firstPage = [
  job("e2e-ledgerly", "Senior Product Designer, Payments", "Ledgerly", { job_min_salary: 75000, job_max_salary: 90000, job_salary_currency: "EUR", job_salary_period: "YEAR" }),
  job("e2e-harbour", "Product Designer, Logistics", "Harbour Freight", { job_publisher: "Indeed" }),
  job("e2e-tulip", "UX Designer", "Tulip Health", { job_is_remote: true, job_location: "Anywhere  •  via Indeed" }),
];
const secondPage = [job("e2e-canal", "Design Systems Designer", "Canal Software")];

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

// Startups (#222): YC job posts and "Who is hiring?" through Hacker News'
// APIs, and the startups' own sites, which the app reaches at
// /startups/<host>/<path>. The profile is in Rotterdam, the Netherlands.
const days = (count: number) => Math.round((Date.now() - count * 86_400_000) / 1000);
const HN_API: Record<string, unknown> = {
  "/v0/jobstories.json": [101, 102],
  "/v0/item/101.json": { id: 101, type: "job", title: "Canalworks (YC W25) Is Hiring a Product Designer (Remote, EU)", url: "https://canalworks.example/careers", time: days(2) },
  "/v0/item/102.json": { id: 102, type: "job", title: "Faraway (YC S24) Is Hiring in Austin, TX", url: "https://www.ycombinator.com/companies/faraway/jobs/1", time: days(20) },
};
const hiringPost = (id: number, text: string) => ({ id, text, created_at: new Date(Date.now() - 3 * 86_400_000).toISOString() });
const ALGOLIA: Record<string, unknown> = {
  "/api/v1/search_by_date": { hits: [{ objectID: "500", title: "Ask HN: Who is hiring? (October 2026)" }] },
  "/api/v1/items/500": {
    children: [
      hiringPost(501, "Harbourlight | Senior Product Designer | Rotterdam, Netherlands | Onsite<p>We design software for ports in Figma. Apply at jobs@harbourlight.example. https://harbourlight.example</p>"),
      hiringPost(502, "Quietco | Product Designer | REMOTE (Europe)<p>Design tools for quiet teams. https://quietco.example</p>"),
      hiringPost(503, "Westcoast | Designer | REMOTE (US only)<p>https://westcoast.example</p>"),
      hiringPost(504, "Tulipworks | UX Designer | Amsterdam, Netherlands<p>https://tulipworks.example</p>"),
    ],
  },
};
const SITES: Record<string, Record<string, string>> = {
  "canalworks.example": {
    "/robots.txt": "User-agent: *\nDisallow: /admin",
    "/": "<p>Say hello@canalworks.example</p>",
    "/careers": '<a href="mailto:jobs@canalworks.example">Apply</a><p>Questions? Ask Lena: lena@canalworks.example</p>',
    "/team": "<p>Lena Visser, design lead: lena@canalworks.example</p>",
  },
  "harbourlight.example": { "/careers": "<p>Write to careers@harbourlight.example</p>" },
  "quietco.example": { "/careers": "<p>We do not accept unsolicited applications.</p><p>hello@quietco.example</p>" },
  "tulipworks.example": { "/robots.txt": "User-agent: Dossier\nDisallow: /", "/careers": "<p>jobs@tulipworks.example</p>" },
};
/** The startups' pages the app asked for, with its user agent, so a spec can check it was polite. */
const siteRequests: { url: string; userAgent: string }[] = [];

function startups(path: string, request: IncomingMessage, response: ServerResponse) {
  const [, host, ...rest] = path.split("/").slice(1);
  const page = `/${rest.join("/")}`;
  if (host === "hacker-news.firebaseio.com") return page in HN_API ? send(response, 200, HN_API[page]) : send(response, 404, null);
  if (host === "hn.algolia.com") return page in ALGOLIA ? send(response, 200, ALGOLIA[page]) : send(response, 404, {});
  siteRequests.push({ url: `https://${host}${page}`, userAgent: String(request.headers["user-agent"] ?? "") });
  const body = SITES[host]?.[page];
  if (body === undefined) return response.writeHead(404, { "content-type": "text/html" }).end("<p>Not found</p>");
  response.writeHead(200, { "content-type": page === "/robots.txt" ? "text/plain" : "text/html; charset=utf-8" }).end(body);
}

/** How many JSearch searches were asked for, so a spec can tell a kept search came from the database. */
let searches = 0;
/** The usage pings the app sent here (DOSSIER_USAGE_PING_TEST_URL), so a spec can tell whether one went (#172). */
const pings: unknown[] = [];
/** What the notification webhook got (E26-2): its headers and body, newest last. */
const webhookPosts: { signature: string | undefined; event: string | undefined; body: string }[] = [];

// The project's backend (DOSSIER_API_URL, E18), in the shape of its contract.
// A spec says what it answers; it's "ok" with no notices until then.
let announcements: unknown = [];
let announcementsAnswer: "ok" | "down" | "silent" = "ok";
const announcementRequests: { url: string | undefined; headers: IncomingMessage["headers"] }[] = [];

function answerAnnouncements(request: IncomingMessage, response: ServerResponse) {
  announcementRequests.push({ url: request.url, headers: request.headers });
  // It never answers, so the app's own timeout has to end the request.
  if (announcementsAnswer === "silent") return;
  if (announcementsAnswer === "down") return send(response, 503, { error: { code: "unavailable", message: "Down for maintenance." } });
  const body = JSON.stringify({ announcements });
  const headers = { "cache-control": "public, max-age=21600", etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
  if (request.headers["if-none-match"] === headers.etag) return void response.writeHead(304, headers).end();
  response.writeHead(200, { "content-type": "application/json", ...headers }).end(body);
}

/** The portal catalog it serves at /v1/portals (E23), as a spec sets it. */
let portalCatalog: unknown = { portals: [], withdrawn: [], commit: null };

function answerPortals(request: IncomingMessage, response: ServerResponse) {
  const body = JSON.stringify(portalCatalog);
  const headers = { "cache-control": "public, max-age=86400", etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"` };
  if (request.headers["if-none-match"] === headers.etag) return void response.writeHead(304, headers).end();
  response.writeHead(200, { "content-type": "application/json", ...headers }).end(body);
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  if (url.pathname === "/v1/announcements") return answerAnnouncements(request, response);
  if (url.pathname === "/v1/portals") return answerPortals(request, response);
  if (url.pathname === "/portals-answer" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      portalCatalog = JSON.parse(body) as unknown;
      response.writeHead(204).end();
    });
    return;
  }
  if (url.pathname === "/announcement-requests") return send(response, 200, { requests: announcementRequests });
  if (url.pathname === "/announcement-answer" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      ({ announcements, answer: announcementsAnswer } = JSON.parse(body) as { announcements: unknown; answer: typeof announcementsAnswer });
      response.writeHead(204).end();
    });
    return;
  }
  if (url.pathname === "/searches") return send(response, 200, { searches });
  if (url.pathname === "/pings") return send(response, 200, { pings });
  if (url.pathname === "/startup-requests") return send(response, 200, { requests: siteRequests });
  if (url.pathname.startsWith("/startups/")) return startups(url.pathname, request, response);
  // A notification channel's webhook (E26-2): it keeps what it got, for a spec to check the signature.
  if (url.pathname === "/webhook-sink" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      webhookPosts.push({ signature: request.headers["x-dossier-signature"] as string | undefined, event: request.headers["x-dossier-event"] as string | undefined, body });
      response.writeHead(204).end();
    });
    return;
  }
  if (url.pathname === "/webhook-posts") return send(response, 200, { posts: webhookPosts });
  if (url.pathname === "/ping" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      pings.push(JSON.parse(body));
      response.writeHead(204).end();
    });
    return;
  }
  // Jev (DOSSIER_TYPESAFE_TEST_BASE_URL, #274): each question answered from
  // its id and line, so a spec knows the score: every Score at its top level
  // but past work one below, a line with "years", "skills" or "experience"
  // required, and shown when it's about product design or Figma.
  if (url.pathname === "/typesafe/v1/systemone" && request.method === "POST") {
    if (request.headers.authorization !== `Bearer ${TYPESAFE_KEY}`) return send(response, 401, { detail: "Invalid API key" });
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const { questions } = JSON.parse(body) as { questions: Record<string, { type: string; criteria?: unknown[]; instructions: unknown }> };
      // The engine's questions (E25): a line's are about the line in quotes.
      const lineOf = (question: { instructions: unknown }) => /"(.*)"/.exec(String(question.instructions))?.[1] ?? "";
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          if (question.type === "score") {
            const top = (question.criteria?.length ?? 1) - 1;
            return [id, { type: "score", score: id === "work" ? top - 1 : top, confidence: 0.9, legend: {}, probabilities: {} }];
          }
          if (question.type === "choice") {
            const choice = id === "seniority" || id === "location" ? "fits" : /years|skills|experience/i.test(lineOf(question)) ? "must" : "other";
            return [id, { type: "choice", choice, confidence: 0.9, probabilities: {} }];
          }
          const covered = id.endsWith("Covered") && /product design|figma/i.test(lineOf(question));
          return [id, { type: "noul", noul: covered ? 0.9 : 0.05 }];
        }),
      );
      send(response, 200, { model: "jev-1.14.0", answers, usage: { input_tokens: 1000, output_tokens: 10 } });
    });
    return;
  }
  // The update check (DOSSIER_UPDATES_TEST_BASE_URL): no release is out, so
  // what a test stores as the latest release stays as it is.
  if (url.pathname === "/github/repos/AienTech/dossier/releases/latest") return send(response, 404, { message: "Not Found" });

  if (url.pathname === "/jsearch/search-v2") {
    if (request.headers["x-api-key"] !== JSEARCH_KEY) return send(response, 401, { status: "ERROR", error: { message: "Invalid API key" } });
    searches += 1;
    // Deterministic agent partial-failure coverage, never a real source call.
    if (/agent-source-failure/.test(url.searchParams.get("query") ?? "")) return send(response, 503, { status: "ERROR", error: { message: "Fixture unavailable" } });
    // "nothing" finds nothing; otherwise two pages, joined by a cursor.
    if (/nothing/i.test(url.searchParams.get("query") ?? "")) return send(response, 200, { status: "OK", data: { jobs: [], cursor: null } });
    const second = url.searchParams.get("cursor") === "PAGE-2";
    return send(response, 200, { status: "OK", request_id: "e2e", data: second ? { jobs: secondPage, cursor: null } : { jobs: firstPage, cursor: "PAGE-2" } });
  }

  if (url.pathname.startsWith("/adzuna/")) {
    return send(response, 200, { count: 1, results: [{ id: "e2e-adzuna", title: "Product Designer", description: "The start…", company: { display_name: "Ledgerly" }, location: { display_name: "Rotterdam" } }] });
  }

  // A portal added from a file in e2e/portals.spec.ts (E23-3).
  if (url.pathname === "/e2e_board/jobs") {
    return send(response, 200, { jobs: [{ id: "canal-1", title: "Service Designer", company: "Canal Works", city: "Rotterdam", link: "https://jobs.example/canal-1" }] });
  }

  // Companies' boards, asked one by one, in e2e/portals.spec.ts (E23): one board answers, any other isn't there.
  const board = /^\/e2e_boards\/([^/]+)\/jobs$/.exec(url.pathname);
  if (board) {
    if (board[1] !== "harbour-works") return send(response, 404, { error: "No such board" });
    return send(response, 200, {
      jobs: [
        { id: "hw-1", title: "Interaction Designer", location: "Rotterdam, Netherlands", link: "https://jobs.example/hw-1", text: "Design the harbour's apps." },
        { id: "hw-2", title: "Interaction Designer", location: "Remote - USA", remote: true, link: "https://jobs.example/hw-2", text: "Design from the US." },
      ],
    });
  }

  if (url.pathname === "/arbeitsagentur/pc/v6/jobs") {
    return send(response, 200, { ergebnisliste: [{ referenznummer: "e2e-ba", stellenangebotsTitel: "Produktdesigner (m/w/d)", firma: "Hafenlogik GmbH" }], maxErgebnisse: 1 });
  }

  if (url.pathname === "/freehire/api/v1/agent/jobs/search") {
    return send(response, 200, {
      data: [
        {
          public_slug: "e2e-ledgerly-designer",
          source: "greenhouse",
          title: "Senior Product Designer, Payments",
          company: "Ledgerly",
          location: "Rotterdam",
          url: "https://jobs.example/e2e-ledgerly",
          work_mode: "onsite",
          posted_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          description: "Ledgerly is hiring a Senior Product Designer for its payments team.",
          enrichment: { salary_min: 75000, salary_max: 90000, salary_currency: "EUR", salary_period: "year" },
        },
      ],
      meta: { total: 1, limit: 20, offset: 0 },
    });
  }

  send(response, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => console.log(`Fake job sources on http://localhost:${port}`));
