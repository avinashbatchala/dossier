import { countryName } from "@/lib/job-search/countries";
import { safeLink } from "@/lib/job-search/search";
import { fromMarkdown, plainText } from "@/lib/job-search/text";
import { decodeEntities, htmlToText } from "@/lib/startups/text";

import type { ValueSpec } from "./format";
import { fill, type Tables, type TemplateValues } from "./template";


// Reading values out of an answer item (E22-1) with a config's value specs:
// a path ("job_title"), or an object that reads and then shapes a value.
// Answers are untrusted: every step checks what it gets, and anything that
// isn't what it expects reads as nothing.

export type Value = string | number | boolean | null;

/** What a path finds: "data.jobs.0.title". Only own properties count, so "__proto__" or "constructor" read as nothing. */
export function at(item: unknown, path: string): unknown {
  let here: unknown = item;
  for (const part of path.split(".")) {
    if (here === null || typeof here !== "object") return undefined;
    if (Array.isArray(here)) {
      if (!/^\d+$/.test(part)) return undefined;
      here = here[Number(part)];
    } else {
      if (!Object.hasOwn(here, part)) return undefined;
      here = (here as Record<string, unknown>)[part];
    }
  }
  return here;
}

/** A found value as a plain one: text, a number or a flag; anything else (a list, an object) as nothing. */
function plain(value: unknown): Value {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // An XML element with attributes keeps its text under "#text" (./xml.ts).
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>)["#text"] === "string") return (value as Record<string, string>)["#text"];
  return null;
}

/** Whether a read value counts: not nothing, and not only spaces. */
const isSet = (value: Value) => value !== null && !(typeof value === "string" && value.trim() === "");

/** A list at a path; a single entry counts as a list of one. */
function listAt(item: unknown, path: string): unknown[] {
  const found = at(item, path);
  if (Array.isArray(found)) return found;
  return found === undefined || found === null ? [] : [found];
}

function asText(value: Value): string {
  return value === null ? "" : String(value);
}

function date(value: Value, as: "iso" | "unix" | "unixMs" | "date"): string | null {
  if (as === "unix" || as === "unixMs") {
    const count = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
    return Number.isFinite(count) && count > 0 ? new Date(as === "unix" ? count * 1000 : count).toISOString() : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = as === "date" ? Date.parse(`${value.trim().slice(0, 10)}T00:00:00Z`) : Date.parse(value.trim());
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export type ReadContext = { tables: Tables; values: TemplateValues };

/** The value a spec reads from an item, or null. */
export function read(item: unknown, spec: ValueSpec | undefined, context: ReadContext): Value {
  if (spec === undefined) return null;
  if (typeof spec === "string") return plain(at(item, spec));

  let value: Value = null;
  if (spec.value !== undefined) value = spec.value;
  else if (spec.template !== undefined) value = fill(spec.template, context.values, context.tables);
  else if (spec.first) {
    for (const option of spec.first) {
      const found = read(item, option, context);
      if (isSet(found)) {
        value = found;
        break;
      }
    }
  } else if (spec.join) {
    value = spec.join.map((part) => asText(read(item, part, context)).trim()).filter(Boolean).join(spec.with ?? " ");
  } else if (spec.each) {
    let parts = listAt(item, spec.each)
      .map((entry) => asText(spec.take ? plain(at(entry, spec.take)) : plain(entry)).trim())
      .filter(Boolean);
    if (spec.unique) parts = [...new Set(parts)];
    if (spec.limit) parts = parts.slice(0, spec.limit);
    value = parts.join(spec.with ?? ", ");
  } else if (spec.find) {
    const shape = (raw: Value) => shaped(raw, { ...spec, find: undefined, where: undefined, take: undefined }, context);
    for (const entry of listAt(item, spec.find)) {
      const matches = Object.entries(spec.where ?? {}).every(([key, wanted]) => plain(at(entry, key)) === wanted);
      if (!matches) continue;
      const found = shape(plain(spec.take ? at(entry, spec.take) : entry));
      if (isSet(found)) return found;
    }
    return null;
  } else if (spec.path !== undefined) value = plain(at(item, spec.path));

  return shaped(value, spec, context);
}

/** A value after the spec's shaping steps, in a fixed order. */
function shaped(input: Value, spec: Exclude<ValueSpec, string>, { tables }: ReadContext): Value {
  let value = input;
  if (spec.map !== undefined && value !== null) {
    const table = typeof spec.map === "string" ? tables[spec.map] : spec.map;
    const key = String(value);
    value = table && Object.hasOwn(table, key) ? (table[key] ?? null) : null;
  }
  if (spec.atLeast !== undefined || spec.equals !== undefined || spec.in !== undefined || spec.contains !== undefined) {
    const matches =
      spec.atLeast !== undefined
        ? (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN) >= spec.atLeast
        : spec.equals !== undefined
          ? value === spec.equals
          : spec.in !== undefined
            ? spec.in.includes(value)
            : typeof value === "string" && value.toLowerCase().includes(spec.contains!.toLowerCase());
    value = spec.then !== undefined ? (matches ? spec.then : null) : matches;
  }
  if (typeof value === "string") {
    if (spec.clean === "html") value = plainText(value);
    else if (spec.clean === "htmlText") value = htmlToText(/^\s*&lt;/.test(value) ? decodeEntities(value) : value);
    else if (spec.clean === "markdown") value = fromMarkdown(value);
    if (spec.split) value = value.split(spec.split)[0];
    if (spec.squash) value = value.replace(/\s+/g, " ").trim();
    if (spec.lower) value = value.toLowerCase();
    if (spec.upper) value = value.toUpperCase();
  }
  if (spec.as) value = spec.as === "countryName" ? (typeof value === "string" && value.trim() ? countryName(value.trim().toLowerCase()) : null) : date(value, spec.as);
  if (spec.link) value = safeLink(typeof value === "string" ? value : null) || null;
  return value;
}

/** A read value as trimmed text, at most `max` long. */
export function textOf(value: Value, max: number): string {
  return asText(value).trim().slice(0, max);
}

/** A read value as a number, when it is one ("60000" counts). */
export function numberOf(value: Value): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}
