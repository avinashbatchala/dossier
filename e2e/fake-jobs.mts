// A stand-in for the job sources (E14-9), started by playwright.config.ts.
// The app sends each source's requests to http://localhost:<port>/<source>
// (DOSSIER_JOBS_TEST_BASE_URL), and this answers in that source's own shape,
// so the adapters' real request and response handling runs end to end.

import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.FAKE_JOBS_PORT ?? 3998);
/** The JSearch key the app is given in e2e/support.ts. */
const JSEARCH_KEY = "e2e-jsearch-key";

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

/** How many JSearch searches were asked for, so a spec can tell a kept search came from the database. */
let searches = 0;
/** The usage pings the app sent here (DOSSIER_USAGE_PING_TEST_URL), so a spec can tell whether one went (#172). */
const pings: unknown[] = [];

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (url.pathname === "/health") return send(response, 200, { ok: true });
  if (url.pathname === "/searches") return send(response, 200, { searches });
  if (url.pathname === "/pings") return send(response, 200, { pings });
  if (url.pathname === "/ping" && request.method === "POST") {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      pings.push(JSON.parse(body));
      response.writeHead(204).end();
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

  send(response, 404, { error: "not found" });
}).listen(port, "127.0.0.1", () => console.log(`Fake job sources on http://localhost:${port}`));
