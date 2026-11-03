import type { EmailLabel } from "./types";

// Reading startups' text (#222): HTML from posts and pages to plain text,
// the email addresses they publish, and a site's domain. Addresses written
// to hide them from robots ("jane at acme dot com") are left alone: the
// person chose not to have them read by a program. Pure functions, shared
// by the sources and the tests.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

/** Decodes HTML entities: named, decimal and hex. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const value = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(value) && value > 0 && value < 0x110000 ? String.fromCodePoint(value) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** HTML as plain text, with paragraphs and line breaks kept, and links written as their address. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
        const url = decodeEntities(href);
        const text = label.replace(/<[^<>]+>/g, "").trim();
        return text && decodeEntities(text) !== url ? `${text} (${url})` : url;
      })
      .replace(/<\s*(p|br|li|div|h\d)[^>]*>/gi, "\n")
      .replace(/<[^<>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    // The line above left single spaces only.
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// At most 64 characters before the @ and 253 after (RFC 5321), which also keeps long text quick to search.
const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}/gi;
/** Addresses that are never someone to write to about a job: images, tracking, examples, support and legal desks. */
const NOT_A_CONTACT =
  /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|sentry|wixpress|sentry-next|domain|email)\.|^(no-?reply|donotreply|mailer-daemon|privacy|dpo|gdpr|datenschutz|abuse|legal|security|dmca|unsubscribe|support|help|billing|invoices?|accounts?|sales|press|media|partners?|marketing)@/i;

/** The email addresses written out in some text, once each, lower case. Hidden ones ("jane at acme dot com") aren't read. */
export function findEmails(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].toLowerCase();
    if (!NOT_A_CONTACT.test(email)) found.add(email);
  }
  return [...found];
}

/** What an address is for, from its name; anything else is someone's own ("Person"). */
export function emailLabel(email: string): EmailLabel {
  const name = email.split("@")[0].toLowerCase();
  if (/^(careers?|jobs?|hiring|recruit(ing|ment|ers?)?|talent|hr|people|join(-?us)?|work(-?with-?us)?|apply|applications?|bewerbung(en)?|karriere|recrutement|empleo|vacatures?)\b/.test(name)) return "Hiring";
  if (/^(founders?|ceo|cto|coo)\b/.test(name)) return "Founders";
  if (/^(hello|hi|hey|contact|info|team|office|mail|kontakt|engineering|eng|dev|developers|tech)\b/.test(name)) return "General";
  return "Person";
}

/** The site's domain without "www.", e.g. "acme.com"; "" for something that isn't a web address. */
export function domainOf(url: string): string {
  try {
    const { hostname, protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? hostname.replace(/^www\./i, "").toLowerCase() : "";
  } catch {
    return "";
  }
}

/** Whether an address belongs to the site: its domain or a subdomain of it. */
export function emailOnDomain(email: string, domain: string): boolean {
  const host = email.split("@")[1] ?? "";
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

/** Sites that host other companies' jobs or pages: a link there doesn't say where the startup's own site is. */
const HOSTING =
  /(^|\.)(ycombinator\.com|greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|bamboohr\.com|recruitee\.com|personio\.(de|com)|smartrecruiters\.com|jobvite\.com|breezy\.hr|teamtailor\.com|rippling\.com|wellfound\.com|angel\.co|linkedin\.com|github\.com|gitlab\.com|notion\.(so|site)|google\.com|forms\.gle|typeform\.com|bit\.ly|t\.co|youtube\.com|twitter\.com|x\.com|medium\.com|substack\.com)$/i;

/** A startup's own site ("https://acme.com") from a link it gave, or "" when the link is to a job board or another host. */
export function companySite(url: string): string {
  const domain = domainOf(url);
  if (!domain || HOSTING.test(domain)) return "";
  return new URL(url).origin;
}

/** The first web address in some text, without the punctuation of the sentence it ends. */
export function firstLink(text: string): string {
  return /https?:\/\/[^\s)<>"']*[^\s)<>"'.,;:!?]/i.exec(text)?.[0] ?? "";
}

/** A short line from a longer text: its first line, cut at `max` characters. */
export function firstLine(text: string, max = 220): string {
  const line = text.split("\n").find((entry) => entry.trim()) ?? "";
  return line.length <= max ? line.trim() : `${line.slice(0, max - 1).trimEnd()}…`;
}

/** "Acme | Senior Android Engineer | Berlin or REMOTE (EU) | Full-time": a hiring post's first line, in parts. */
export function headerParts(text: string): string[] {
  return firstLine(text, 400)
    .split(/\s+[|•·—–]\s+|\s+-\s+|\s*\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const LEFT_OUT = "[address left out]";

/**
 * Text with every email address taken out, written out or hidden ("jane at
 * acme dot com", "jane [at] acme [dot] com"), for what's handed to the AI:
 * addresses stay in Dossier.
 */
export function withoutAddresses(text: string): string {
  return text
    .replace(/mailto:[^\s)"'>]+/gi, LEFT_OUT)
    .replace(/[a-z0-9._%+-]{1,64}\s*[[({<]\s*at\s*[\])}>]\s*[a-z0-9-]+(?:\s*(?:[[({<]\s*dot\s*[\])}>]|\.)\s*[a-z0-9-]+)+/gi, LEFT_OUT)
    .replace(/\b[a-z0-9._%+-]{1,64}\s+at\s+[a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+\b/gi, LEFT_OUT)
    .replace(/[a-z0-9._%+-]{1,64}\s*@\s*[a-z0-9-]+(?:\s*\.\s*[a-z0-9-]+)*\.[a-z]{2,24}\b/gi, LEFT_OUT);
}

/** Ways a page says it takes no unsolicited applications, in the languages startups write in most. */
const NO_APPLICATIONS = [
  /\b(?:do\s+not|don['’]t|cannot|can['’]t|will\s+not|won['’]t)\s+(?:accept|consider|respond\s+to)\s+(?:any\s+)?unsolicited\s+(?:job\s+)?(?:applications|resumes|résumés|cvs?|emails?)\b/i,
  /\bno\s+unsolicited\s+(?:job\s+)?(?:applications|resumes|résumés|cvs?|emails?)\b/i,
  /\bunsolicited\s+(?:applications|resumes|résumés|cvs?)\s+(?:will\s+not|won['’]t|are\s+not)\b/i,
  /\b(?:no|do\s+not\s+accept|don['’]t\s+accept)\s+speculative\s+applications\b/i,
  /\bkeine\s+(?:initiativbewerbungen|unaufgeforderten\s+bewerbungen)\b/i,
  /\binitiativbewerbungen\s+(?:sind\s+)?(?:leider\s+)?(?:nicht|un)(?:\s*erwünscht|\s*gewünscht|\s*möglich)/i,
  /\bpas\s+de\s+candidatures?\s+spontan[ée]es?\b/i,
  /\bn['’](?:acceptons|accepte)\s+pas\s+(?:de\s+|les\s+)?candidatures?\s+spontan[ée]es?\b/i,
  /\bno\s+(?:aceptamos|se\s+aceptan)\s+candidaturas\s+espont[áa]neas\b/i,
  /\bgeen\s+open\s+sollicitaties\b/i,
  /\bnon\s+accettiamo\s+candidature\s+spontanee\b/i,
  /\bn[ãa]o\s+aceitamos\s+candidaturas\s+espont[âa]neas\b/i,
];
/** "…unsolicited résumés from recruiters": about agencies, not people applying. */
const AGENCIES = /recruit|agenc|search\s+firm|third[-\s]part|headhunt|staffing|vermittl|personaldienst|cabinets?\s+de\s+recrutement/i;

/**
 * The sentence where a page says it takes no unsolicited applications, or ""
 * when it doesn't. Sentences about recruiters and agencies don't count.
 */
export function noApplicationsSentence(text: string): string {
  for (const pattern of NO_APPLICATIONS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const start = match.index ?? 0;
      const around = text.slice(Math.max(0, start - 80), start + match[0].length + 120);
      if (AGENCIES.test(around)) continue;
      const sentenceStart = Math.max(text.lastIndexOf(".", start), text.lastIndexOf("\n", start)) + 1;
      const ends = [text.indexOf(".", start + match[0].length), text.indexOf("\n", start + match[0].length)].filter((index) => index >= 0);
      const sentenceEnd = ends.length > 0 ? Math.min(...ends) + 1 : text.length;
      return text.slice(sentenceStart, sentenceEnd).replace(/\s+/g, " ").trim().slice(0, 300);
    }
  }
  return "";
}
