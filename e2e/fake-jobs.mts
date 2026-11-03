// A stand-in for the job sources (E14-9), started by playwright.config.ts.
// The app sends each source's requests to http://localhost:<port>/<source>
// (DOSSIER_JOBS_TEST_BASE_URL), and this answers in that source's own shape,
// so the adapters' real request and response handling runs end to end.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.FAKE_JOBS_PORT ?? 3998);
/** The JSearch key the app is given in e2e/support.ts. */
const JSEARCH_KEY = "e2e-jsearch-key";
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
  job_posted_at_datetime_utc: new Date(Date.now() - 2 * 86_400_000).toISOString(),
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

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  if (url.pathname === "/searches") return send(response, 200, { searches });
  if (url.pathname === "/pings") return send(response, 200, { pings });
  if (url.pathname === "/startup-requests") return send(response, 200, { requests: siteRequests });
  if (url.pathname.startsWith("/startups/")) return startups(url.pathname, request, response);
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
      const lineOf = (question: { instructions: unknown }) => String((question.instructions as { line?: string }).line ?? "");
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, question]) => {
          if (question.type === "score") {
            const top = (question.criteria?.length ?? 1) - 1;
            return [id, { type: "score", score: id === "work" ? top - 1 : top, confidence: 0.9, legend: {}, probabilities: {} }];
          }
          if (question.type === "choice") {
            const required = /years|skills|experience/i.test(lineOf(question));
            return [id, { type: "choice", choice: required ? "required" : "other", confidence: 0.9, probabilities: {} }];
          }
          const shown = id.endsWith("Shown") && /product design|figma/i.test(lineOf(question));
          return [id, { type: "noul", noul: shown ? 0.9 : 0.05 }];
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
    // "nothing" finds nothing; otherwise two pages, joined by a cursor.
    if (/nothing/i.test(url.searchParams.get("query") ?? "")) return send(response, 200, { status: "OK", data: { jobs: [], cursor: null } });
    const second = url.searchParams.get("cursor") === "PAGE-2";
    return send(response, 200, { status: "OK", request_id: "e2e", data: second ? { jobs: secondPage, cursor: null } : { jobs: firstPage, cursor: "PAGE-2" } });
  }

  if (url.pathname.startsWith("/adzuna/")) {
    return send(response, 200, { count: 1, results: [{ id: "e2e-adzuna", title: "Product Designer", description: "The start…", company: { display_name: "Ledgerly" }, location: { display_name: "Rotterdam" } }] });
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
