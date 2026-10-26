import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import zlib from "node:zlib";

import { parse, type HTMLElement, type Node } from "node-html-parser";

import { appVersion } from "@/lib/version";

// "Fetch" on a new application (E7-8, NEW-9): the server downloads the
// posting's page and pulls out its text for the user to review. A plain
// request, no browser (decided 29 September 2026): the JobPosting data most
// job sites embed for search engines comes first, else the page's main text.
// The address is the user's to type, so the request never goes to the
// server's own network (SSRF), and it's limited in size, time and redirects.

export const FETCH_MESSAGES = {
  notWeb: "That link doesn't look like a web address.",
  privateAddress: "Dossier doesn't fetch addresses on your own network. Paste the posting instead.",
  unreachable: "The job site couldn't be reached. Without internet access, or if the site blocks it, paste the posting instead.",
  failed: (status: number) => `The job site answered with an error (${status}). Paste the posting instead.`,
  tooBig: "That page is too big to be a job posting. Paste the posting instead.",
  notPage: "That link isn't a web page. Paste the posting instead.",
  unreadable:
    "There's no posting text on that page that Dossier can read: the site probably builds it in the browser. Paste the posting instead.",
};

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** Less than this isn't a posting: a cookie wall, an error page or a script shell. */
const MIN_CHARACTERS = 200;

export type FetchedPosting = { ok: true; text: string; source: "structured" | "page"; url: string } | { ok: false; error: string };

// ─── Where requests may go ───────────────────────────────────────────────────

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet, not a private, local or reserved network. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return !blocked.check(address, "ipv4");
  if (version !== 6) return false;
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, "ipv6");
}

/** DNS lookup that refuses private answers, checked when connecting, so a redirect or a DNS trick can't get around it. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0);
    const list = addresses as LookupAddress[];
    const refused = list.find((entry) => !isPublicAddress(entry.address));
    if (refused || list.length === 0) {
      return callback(Object.assign(new Error("private address"), { code: "EPRIVATE" }), "", 0);
    }
    if (options.all) return (callback as unknown as (error: null, addresses: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

// ─── Fetching ────────────────────────────────────────────────────────────────

type Response = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

const USER_AGENT = `Mozilla/5.0 (compatible; Dossier/${appVersion}; self-hosted job search)`;

/** One request, with the guarded lookup, a time limit and a size limit. */
function request(url: URL, lookup: LookupFunction, timeoutMs: number, userAgent: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const outgoing = client.get(
      url,
      {
        lookup,
        headers: {
          "user-agent": userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en;q=0.9, *;q=0.5",
        },
        timeout: timeoutMs,
      },
      (incoming) => {
        const encoding = String(incoming.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip"
            ? incoming.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? incoming.pipe(zlib.createInflate())
              : encoding === "br"
                ? incoming.pipe(zlib.createBrotliDecompress())
                : incoming;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            outgoing.destroy(Object.assign(new Error("too big"), { code: "ETOOBIG" }));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body: Buffer.concat(chunks) }));
        stream.on("error", reject);
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    outgoing.on("error", reject);
  });
}

/**
 * The posting at `link`: its text, or why it can't be had, in plain words.
 * `lookup` and `timeoutMs` are for tests, which serve pages on localhost.
 */
export async function fetchPosting(
  link: string,
  { lookup = guardedLookup, timeoutMs = TIMEOUT_MS }: { lookup?: LookupFunction; timeoutMs?: number } = {},
): Promise<FetchedPosting> {
  const page = await fetchHtml(link, { lookup, timeoutMs });
  if (!page.ok) return { ok: false, error: page.error };
  const posting = postingFromHtml(page.html);
  if (!posting) return { ok: false, error: FETCH_MESSAGES.unreadable };
  return { ok: true, ...posting, url: page.url };
}

export type FetchedPage = { ok: true; html: string; url: string } | { ok: false; error: string; status?: number };

/**
 * A web page's text, with the same guards as fetching a posting: public
 * addresses only (checked again after every redirect), and limits on time,
 * size and redirects. `status` is the site's answer when it refused. Used
 * for postings, and for a startup's own pages and robots.txt (#222), which
 * pass Dossier's identifying `userAgent`.
 */
export async function fetchHtml(
  link: string,
  { lookup = guardedLookup, timeoutMs = TIMEOUT_MS, userAgent = USER_AGENT }: { lookup?: LookupFunction; timeoutMs?: number; userAgent?: string } = {},
): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { ok: false, error: FETCH_MESSAGES.notWeb };
  }
  const deadline = Date.now() + timeoutMs;
  for (let redirects = 0; ; redirects++) {
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return { ok: false, error: FETCH_MESSAGES.notWeb };
    }
    // The lookup isn't asked about addresses typed as IPs.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (lookup === guardedLookup && (isIP(host) ? !isPublicAddress(host) : /(^|\.)localhost\.?$/i.test(host))) {
      return { ok: false, error: FETCH_MESSAGES.privateAddress };
    }
    let response: Response;
    try {
      response = await Promise.race([
        request(url, lookup, timeoutMs, userAgent),
        new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), Math.max(0, deadline - Date.now())).unref()),
      ]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "EPRIVATE") return { ok: false, error: FETCH_MESSAGES.privateAddress };
      if (code === "ETOOBIG") return { ok: false, error: FETCH_MESSAGES.tooBig };
      return { ok: false, error: FETCH_MESSAGES.unreachable };
    }

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (redirects >= MAX_REDIRECTS) return { ok: false, error: FETCH_MESSAGES.unreachable };
      url = new URL(location, url);
      continue;
    }
    if (response.status >= 400) return { ok: false, error: FETCH_MESSAGES.failed(response.status), status: response.status };

    const type = String(response.headers["content-type"] ?? "");
    if (type && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(type)) return { ok: false, error: FETCH_MESSAGES.notPage };
    return { ok: true, html: decode(response.body, type), url: url.toString() };
  }
}

/** The body as text, in the charset the server named (UTF-8 otherwise). */
function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

// ─── Reading the page ────────────────────────────────────────────────────────

/** The posting's text from a page: its JobPosting data if it has any, else its main text. */
export function postingFromHtml(html: string): { text: string; source: "structured" | "page" } | null {
  const root = parse(html, { blockTextElements: { script: true, style: false, noscript: false, pre: true } });
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    const posting = jobPostingIn(parseJson(script.rawText));
    const text = posting && jobPostingText(posting);
    if (text && text.length >= MIN_CHARACTERS) return { text, source: "structured" };
  }
  for (const noise of root.querySelectorAll("script, style, noscript, template, svg, nav, header, footer, aside, form, iframe, button")) {
    noise.remove();
  }
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector('[role="main"]') ?? root.querySelector("body") ?? root;
  const text = textOf(main);
  return text.length >= MIN_CHARACTERS ? { text, source: "page" } : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

type JobPosting = Record<string, unknown>;

/** The first JobPosting in JSON-LD, which can be an object, a list or an @graph. */
function jobPostingIn(data: unknown): JobPosting | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = jobPostingIn(item);
      if (found) return found;
    }
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const type = record["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return record;
  return jobPostingIn(record["@graph"]);
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const nameOf = (value: unknown): string => str(value) || (value && typeof value === "object" ? str((value as Record<string, unknown>).name) : "");

/** A posting as a person would paste it: title and company, the facts, then the description. */
function jobPostingText(posting: JobPosting): string {
  const title = str(posting.title);
  const company = nameOf(posting.hiringOrganization);
  const locations = [posting.jobLocation].flat().flatMap((place) => {
    const address = place && typeof place === "object" ? (place as Record<string, unknown>).address : null;
    if (!address || typeof address !== "object") return [];
    const parts = address as Record<string, unknown>;
    return [[str(parts.addressLocality), str(parts.addressRegion), nameOf(parts.addressCountry)].filter(Boolean).join(", ")];
  });
  const remote = str(posting.jobLocationType) === "TELECOMMUTE" ? "Remote" : "";
  const deadline = str(posting.validThrough).slice(0, 10);
  const facts = [
    [...new Set(locations.filter(Boolean))].join(" / "),
    remote,
    [posting.employmentType].flat().map(str).filter(Boolean).join(", ").toLowerCase().replaceAll("_", " "),
    salaryOf(posting.baseSalary),
    deadline && `Apply by ${deadline}`,
  ].filter(Boolean);
  const description = htmlText(str(posting.description));
  return [[company, title].filter(Boolean).join(": "), facts.join(" · "), description].filter(Boolean).join("\n\n");
}

/** "EUR 75000–90000 per year" from schema.org's MonetaryAmount. */
function salaryOf(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const salary = value as Record<string, unknown>;
  const amount = (salary.value && typeof salary.value === "object" ? salary.value : {}) as Record<string, unknown>;
  const range = [str(amount.minValue), str(amount.maxValue)].filter(Boolean).join("–") || str(amount.value) || str(salary.value);
  if (!range) return "";
  const unit = str(amount.unitText).toLowerCase();
  return [str(salary.currency), range, unit && `per ${unit}`].filter(Boolean).join(" ");
}

/** Text from HTML, including HTML that arrives escaped (&lt;p&gt;), as in many JSON-LD descriptions. */
function htmlText(html: string): string {
  let text = textOf(parse(html));
  if (/<\/?(p|li|ul|br|div|strong)\b/i.test(text)) text = textOf(parse(text));
  return text;
}

const BLOCK = new Set(["p", "div", "section", "article", "main", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "br", "hr", "dl", "dt", "dd", "blockquote", "pre"]);

/** The readable text of an element: blocks on their own lines, list items as "- ", spaces tidied. */
function textOf(node: Node): string {
  const lines: string[] = [];
  let line = "";
  const flush = () => {
    const tidy = line.replace(/\s+/g, " ").trim();
    if (tidy) lines.push(tidy);
    line = "";
  };
  const walk = (current: Node) => {
    if (current.nodeType === 3) {
      line += current.text;
      return;
    }
    const element = current as HTMLElement;
    const tag = element.rawTagName?.toLowerCase() ?? "";
    const block = BLOCK.has(tag);
    if (block) flush();
    if (tag === "li") line += "- ";
    for (const child of element.childNodes) walk(child);
    if (block) flush();
  };
  walk(node);
  flush();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
