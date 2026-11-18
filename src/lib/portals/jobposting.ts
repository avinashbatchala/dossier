import "server-only";

import { parse } from "node-html-parser";

import type { PostingSpec } from "./format";

// Pages with schema.org JobPosting data (E22-1), such as a company's careers
// page: every JobPosting in their JSON-LD is a posting. JobPosting has the
// same shape everywhere, so a config of this kind needs no mapping of its own.

const MAX_POSTINGS = 500;

type Json = Record<string, unknown>;

const isJobPosting = (record: Json) => {
  const type = record["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
};

/** Every JobPosting in a page's JSON-LD: an object, a list, an @graph, or an ItemList's entries. */
export function jobPostingsIn(html: string): Json[] {
  const found: Json[] = [];
  const visit = (data: unknown, depth: number) => {
    if (found.length >= MAX_POSTINGS || depth > 6 || !data || typeof data !== "object") return;
    if (Array.isArray(data)) {
      for (const entry of data) visit(entry, depth + 1);
      return;
    }
    const record = data as Json;
    if (isJobPosting(record)) {
      found.push(record);
      return;
    }
    visit(record["@graph"], depth + 1);
    visit(record.itemListElement, depth + 1);
    visit(record.item, depth + 1);
  };
  for (const script of parse(html).querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.rawText) as unknown, 0);
    } catch {
      // A broken block is skipped; the others still count.
    }
  }
  return found;
}

const PERIODS = { YEAR: "a year", MONTH: "a month", WEEK: "a week", DAY: "a day", HOUR: "an hour" };

/** Where each part of a posting is in a schema.org JobPosting. */
export const JOBPOSTING_SPEC: PostingSpec = {
  id: { first: ["identifier.value", "identifier", { path: "url", link: true }] },
  title: { path: "title", clean: "html" },
  company: { first: ["hiringOrganization.name", "hiringOrganization"] },
  place: { first: ["jobLocation.address.addressLocality", "jobLocation.0.address.addressLocality", "jobLocation.address.addressRegion"] },
  remote: { path: "jobLocationType", equals: "TELECOMMUTE", then: true },
  salary: {
    min: { first: ["baseSalary.value.minValue", "baseSalary.minValue", "baseSalary.value.value"] },
    max: { first: ["baseSalary.value.maxValue", "baseSalary.maxValue"] },
    currency: { first: ["baseSalary.currency", "salaryCurrency"] },
    period: { first: ["baseSalary.value.unitText", "baseSalary.unitText"] },
    periods: PERIODS,
  },
  postedAt: { path: "datePosted", as: "iso" },
  url: { first: [{ path: "url", link: true }, { path: "sameAs", link: true }] },
  description: { path: "description", clean: "html" },
  complete: "description",
};
