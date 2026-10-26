import "server-only";

import { z } from "zod";

import { getJson, SourceError } from "../http";
import { companySite, htmlToText } from "../text";
import type { FoundStartup } from "../types";

// YC startups' job posts (#222), from Hacker News' official API
// (https://github.com/HackerNews/API), which YC publishes for anyone to use.
// Only YC companies may post jobs on Hacker News, as "Acme (YC W24) Is
// Hiring a Founding Engineer", linking to the job.

const API = "https://hacker-news.firebaseio.com/v0";
export const hnItemLink = (id: string | number) => `https://news.ycombinator.com/item?id=${id}`;
const CONCURRENCY = 6;

const itemSchema = z.object({
  id: z.number(),
  type: z.string().nullish(),
  title: z.string().nullish(),
  url: z.string().nullish(),
  text: z.string().nullish(),
  time: z.number().nullish(),
  dead: z.boolean().nullish(),
  deleted: z.boolean().nullish(),
});
type Item = z.output<typeof itemSchema>;

/** "Acme (YC W24) Is Hiring a Founding Engineer in SF" in parts. */
export function readJobTitle(title: string): { company: string; batch: string; rest: string } {
  const tagged = /^(.+?)\s*\(\s*YC\s+([A-Z]\d{2})\s*\)\s*(.*)$/i.exec(title);
  if (tagged) return { company: tagged[1].trim(), batch: tagged[2].toUpperCase(), rest: tagged[3].trim() };
  const hiring = /^(.+?)\s+(?:is|are)\s+hiring\b(.*)$/i.exec(title);
  if (hiring) return { company: hiring[1].trim(), batch: "", rest: `is hiring${hiring[2]}`.trim() };
  return { company: title.trim(), batch: "", rest: "" };
}

/** A YC job post as a startup, or null when it isn't one. */
export function startupFromJob(item: Item): FoundStartup | null {
  if (item.type !== "job" || item.dead || item.deleted || !item.title) return null;
  const { company, batch, rest } = readJobTitle(item.title);
  if (!company) return null;
  const url = /^https?:\/\//i.test(item.url ?? "") ? item.url!.trim() : "";
  // "Is Hiring a Founding Engineer in SF" → "Founding Engineer in SF".
  const role = rest.replace(/^(?:is|are)\s+hiring\b[\s:–—-]*/i, "").replace(/^(?:an?|for)\s+/i, "").trim();
  // Places are in brackets, or after "in": "(Remote, worldwide)", "[Berlin, on-site]", "in Austin, TX".
  const places = [...rest.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((match) => (match[1] ?? match[2]).trim());
  const inPlace = /\bin\s+([A-Z][^()[\]]*)$/.exec(rest.replace(/\s*[([].*$/, ""))?.[1]?.trim();
  return {
    source: "YC",
    externalId: String(item.id),
    company: company.slice(0, 200),
    website: url ? companySite(url) : "",
    summary: item.title.trim(),
    details: item.text ? htmlToText(item.text).slice(0, 20_000) : "",
    location: [inPlace, ...places].filter(Boolean).join(" · ").slice(0, 300),
    remote: /\bremote\b/i.test(rest) ? true : null,
    stage: batch ? `YC ${batch}` : "",
    roles: role && !/^in\s/i.test(role) ? [role.slice(0, 160)] : [],
    emails: [],
    links: [...(url ? [{ label: "Job post", url }] : []), { label: "On Hacker News", url: hnItemLink(item.id) }],
    postedAt: item.time ? new Date(item.time * 1000).toISOString() : null,
  };
}

/** The YC job posts on Hacker News now. */
export async function fetchYcStartups(signal?: AbortSignal): Promise<FoundStartup[]> {
  const ids = z.array(z.number()).safeParse(await getJson(`${API}/jobstories.json`, { signal }));
  if (!ids.success) throw new SourceError("changed its format");
  const items: (Item | null)[] = [];
  const wanted = ids.data.slice(0, 100);
  for (let index = 0; index < wanted.length; index += CONCURRENCY) {
    signal?.throwIfAborted();
    const batch = await Promise.allSettled(wanted.slice(index, index + CONCURRENCY).map((id) => getJson(`${API}/item/${id}.json`, { signal })));
    for (const result of batch) {
      const parsed = result.status === "fulfilled" ? itemSchema.safeParse(result.value) : null;
      items.push(parsed?.success ? parsed.data : null);
    }
  }
  if (wanted.length > 0 && items.every((item) => item === null)) throw new SourceError("didn't answer for any of its job posts");
  return items.flatMap((item) => (item ? (startupFromJob(item) ?? []) : []));
}
