// Templates and conditions in portal configs (E22-1): "{keywords} in {place}",
// "{base}/{country}/search/{page}", "{postedWithin|map:datePosted}", and
// `when: "place"`. A template only reads values; it can't run anything.

/** The names a template or condition may use, besides `fields.<name>` for the config's own fields. */
export const QUERY_NAMES = ["keywords", "place", "country", "radiusKm", "remoteOnly", "postedWithin", "postedDays", "level"] as const;
export const PAGING_NAMES = ["page", "offset", "cursor", "size"] as const;
export const OTHER_NAMES = ["base", "id"] as const;
/** The list entry a search for each entry is asking for (`search.each`). */
export const EACH_NAME = "each";

/** What a filter after "|" does to a value. */
const FILTERS = ["upper", "lower", "title", "default", "map", "base64", "url", "raw"] as const;

export type TemplateValues = Readonly<Record<string, string>>;
export type Tables = Readonly<Record<string, Readonly<Record<string, string>>>>;

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9.]*)((?:\|[a-z0-9]+(?::[^|}]*)?)*)\}/g;

type Placeholder = { name: string; filters: { filter: string; argument: string }[] };

function placeholders(template: string): Placeholder[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => ({
    name: match[1],
    filters: match[2]
      .split("|")
      .filter(Boolean)
      .map((part) => {
        const [filter, ...rest] = part.split(":");
        return { filter, argument: rest.join(":") };
      }),
  }));
}

/** What's wrong with a template's names and filters, for the config's check; empty when nothing is. */
export function templateProblems(template: string, known: ReadonlySet<string>, tables: Tables): string[] {
  const problems: string[] = [];
  const stripped = template.replace(PLACEHOLDER, "");
  if (/[{}]/.test(stripped)) problems.push(`"${template}" has a { or } that isn't a placeholder.`);
  for (const { name, filters } of placeholders(template)) {
    if (!known.has(name)) problems.push(`{${name}} isn't a name a template can use.`);
    for (const { filter, argument } of filters) {
      if (!(FILTERS as readonly string[]).includes(filter)) problems.push(`|${filter} isn't a filter.`);
      if (filter === "map" && !Object.hasOwn(tables, argument)) problems.push(`|map:${argument} names no table in maps.`);
    }
  }
  return problems;
}

function filtered(value: string, filters: Placeholder["filters"], tables: Tables): { value: string; raw: boolean } {
  let out = value;
  let raw = false;
  for (const { filter, argument } of filters) {
    if (filter === "upper") out = out.toUpperCase();
    else if (filter === "lower") out = out.toLowerCase();
    // "acme-corp" → "Acme Corp": a board's name as a company's.
    else if (filter === "title") out = out.replace(/[-_.]+/g, " ").replace(/(^|\s)(\p{Ll})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
    else if (filter === "default") out = out || argument;
    else if (filter === "map") out = tables[argument]?.[out] ?? "";
    else if (filter === "base64") out = Buffer.from(out).toString("base64");
    else if (filter === "url") out = encodeURIComponent(out);
    else if (filter === "raw") raw = true;
  }
  return { value: out, raw };
}

/**
 * The template with its placeholders filled in. In an address (`inUrl`),
 * every value but {base} is encoded for the path, unless it says `|raw`.
 */
export function fill(template: string, values: TemplateValues, tables: Tables, { inUrl = false }: { inUrl?: boolean } = {}): string {
  return template.replace(PLACEHOLDER, (_whole, name: string, filters: string) => {
    const { value, raw } = filtered(values[name] ?? "", placeholders(`{${name}${filters}}`)[0].filters, tables);
    return inUrl && !raw && name !== "base" ? encodeURIComponent(value) : value;
  });
}

const CONDITION = /^(!?)([A-Za-z][A-Za-z0-9.]*)(?:(!?=)(.+))?$/;

/** The names a condition reads, for the config's check. */
export function conditionName(condition: string): string | null {
  return CONDITION.exec(condition)?.[2] ?? null;
}

/** Whether a condition holds: "place" when there's a place, "!place" when there isn't, "level=senior|lead". */
export function holds(condition: string, values: TemplateValues): boolean {
  const match = CONDITION.exec(condition);
  if (!match) return false;
  const [, negate, name, operator, options] = match;
  const value = values[name] ?? "";
  if (!operator) {
    const set = value !== "" && value !== "false";
    return negate ? !set : set;
  }
  const inList = options.split("|").includes(value);
  return operator === "=" ? inList : !inList;
}

/** Whether every condition holds; none always does. */
export function allHold(when: string | readonly string[] | undefined, values: TemplateValues): boolean {
  if (when === undefined) return true;
  return (typeof when === "string" ? [when] : when).every((condition) => holds(condition, values));
}
