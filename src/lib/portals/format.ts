import { z } from "zod";

import { conditionName, EACH_NAME, OTHER_NAMES, PAGING_NAMES, QUERY_NAMES, templateProblems, type Tables } from "./template";

// The portal config format (E22-1, #387): a job portal described as data,
// read by one engine (./engine.ts). A config never runs code: it says where
// to ask, what to send and where things are in the answer. It can only reach
// the hosts it lists, and it never names environment variables, so a config
// from the market can't read the server's secrets. Built-in portals map
// their env vars in code (src/lib/job-search/config.ts).
//
// The same schema is written out as JSON Schema (portal-config.schema.json,
// `yarn portal-schema`) for the public config repository's checks.

const PORTAL_FORMAT = 1;

/** A portal's id, as rows store it (#269): "JSEARCH", "JOBS_CH". */
const portalIdSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, "An id is 2 to 40 capital letters, digits and underscores, starting with a letter.");

const LOCAL_HOST = /(^|\.)(localhost|local|internal|lan|home\.arpa)\.?$/i;
/** Dotted IPv4 (the host pattern already refuses IPv6, which has colons). */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** A host name a config may reach: a public DNS name, never an IP address or a local name. */
const hostSchema = z
  .string()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/, "A host is a lower-case DNS name, such as api.example.com.")
  .refine((host) => !IPV4.test(host) && !LOCAL_HOST.test(host), "A host must be on the public internet, not an IP address or a local name.");

const httpsUrl = z.url({ protocol: /^https$/, error: "Use an https:// address." }).max(2000);

/** "{base}/jobs/{country}": filled from the query, the fields and the page (./template.ts). */
const templateSchema = z.string().min(1).max(2000);

/** "place", "!place", "level=senior|lead", "postedDays": when a parameter is sent. */
const conditionSchema = z.string().regex(/^!?[A-Za-z][A-Za-z0-9.]*(?:!?=[A-Za-z0-9_|-]+)?$/, 'A condition is a name, "!name", "name=a|b" or "name!=a|b".');
const whenSchema = z.union([conditionSchema, z.array(conditionSchema).min(1).max(10)]);

const literalSchema = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

/** "data.jobs", "apply_options.0.apply_link": a path into the answer. */
const pathSchema = z.string().regex(/^[A-Za-z0-9_@#$:-]+(?:\.[A-Za-z0-9_@#$:-]+)*$/, 'A path is names joined by dots, such as "data.jobs.0.title".');

/** How one value is read from an answer item (./values.ts). */
export type ValueSpec =
  | string
  | {
      path?: string;
      value?: string | number | boolean | null;
      template?: string;
      first?: ValueSpec[];
      join?: ValueSpec[];
      with?: string;
      each?: string;
      take?: string;
      unique?: boolean;
      limit?: number;
      find?: string;
      where?: Record<string, string | number | boolean | null>;
      clean?: "html" | "htmlText" | "markdown";
      split?: string;
      squash?: boolean;
      lower?: boolean;
      upper?: boolean;
      map?: string | Record<string, string | number | boolean | null>;
      atLeast?: number;
      equals?: string | number | boolean | null;
      in?: (string | number | boolean | null)[];
      contains?: string;
      then?: string | number | boolean | null;
      as?: "iso" | "unix" | "unixMs" | "date" | "countryName";
      link?: boolean;
    };

const valueSpecSchema: z.ZodType<ValueSpec> = z.lazy(() =>
  z.union([
    pathSchema,
    z.strictObject({
      /** Where the value is. */
      path: pathSchema.optional(),
      /** A fixed value. */
      value: literalSchema.optional(),
      /** Text made from the item's id and the query: "https://example.com/jobs/{id}". */
      template: templateSchema.optional(),
      /** The first of these that has a value. */
      first: z.array(valueSpecSchema).min(1).max(10).optional(),
      /** These, the empty ones left out, joined `with`. */
      join: z.array(valueSpecSchema).min(1).max(10).optional(),
      with: z.string().max(10).optional(),
      /** A list at this path, each entry's `take`, joined `with`. */
      each: pathSchema.optional(),
      take: pathSchema.optional(),
      unique: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      /** The first entry of the list at this path that matches `where` and has a `take`. */
      find: pathSchema.optional(),
      where: z.record(z.string().max(100), literalSchema).optional(),
      /**
       * HTML to text on one line; HTML to text with its paragraphs and line
       * breaks, for a whole posting (HTML sent escaped, "&lt;p&gt;", too); or
       * light Markdown to text with its line breaks.
       */
      clean: z.enum(["html", "htmlText", "markdown"]).optional(),
      /** The part before this text: "Hamburg • via Stepstone" with "•". */
      split: z.string().min(1).max(10).optional(),
      /** Runs of spaces and line breaks as one space. */
      squash: z.boolean().optional(),
      lower: z.boolean().optional(),
      upper: z.boolean().optional(),
      /** A value looked up in this table, or in one of the config's `maps` by name. */
      map: z.union([z.string().max(40), z.record(z.string().max(100), literalSchema)]).optional(),
      /** A number at least this: true, or `then`; otherwise false, or nothing with `then`. */
      atLeast: z.number().optional(),
      /** Equal to this: true, or `then`; otherwise false, or nothing with `then`. */
      equals: literalSchema.optional(),
      /** One of these: true, or `then`; otherwise false, or nothing with `then`. */
      in: z.array(literalSchema).min(1).max(20).optional(),
      /** Text with this in it, case ignored ("Remote - US" for "remote"): true, or `then`; otherwise false, or nothing with `then`. */
      contains: z.string().min(1).max(100).optional(),
      then: literalSchema.optional(),
      /** A date as ISO text, a Unix time in seconds or milliseconds, or a day ("2026-11-14"); or a country code as its name. */
      as: z.enum(["iso", "unix", "unixMs", "date", "countryName"]).optional(),
      /** Kept only when it's an http(s) address. */
      link: z.boolean().optional(),
    }),
  ]),
);

const salarySchema = z.strictObject({
  /** The salary as the portal writes it, used when there is one. */
  text: valueSpecSchema.optional(),
  min: valueSpecSchema.optional(),
  max: valueSpecSchema.optional(),
  currency: valueSpecSchema.optional(),
  /** "YEAR", "month": looked up in `periods`, case ignored. */
  period: valueSpecSchema.optional(),
  periods: z.record(z.string().max(20), z.string().max(20)).optional(),
  /** The period when the portal doesn't say: "a year". */
  defaultPeriod: z.string().max(20).optional(),
  /** True when the portal only estimated it: "(estimated)" is added. */
  estimated: valueSpecSchema.optional(),
});

/** Where each part of a posting is in an answer item. */
const postingSpecSchema = z.strictObject({
  id: valueSpecSchema,
  title: valueSpecSchema.optional(),
  company: valueSpecSchema.optional(),
  place: valueSpecSchema.optional(),
  remote: valueSpecSchema.optional(),
  salary: salarySchema.optional(),
  postedAt: valueSpecSchema.optional(),
  url: valueSpecSchema.optional(),
  /** Where the portal got it from, e.g. "LinkedIn". */
  via: valueSpecSchema.optional(),
  /** The employer's own apply link, when the portal has one (for merging duplicates, E22-6). */
  applyLink: valueSpecSchema.optional(),
  description: valueSpecSchema.optional(),
  /** Whether the description is the whole posting: always, never, or when there is one. */
  complete: z.union([z.boolean(), z.literal("description")]).default(false),
});
export type PostingSpec = z.output<typeof postingSpecSchema>;

const paramSchema = z.strictObject({
  name: z.string().min(1).max(100),
  value: templateSchema,
  /** Sent only when this holds. Parameters whose value comes out empty are left out anyway. */
  when: whenSchema.optional(),
});

const pagingSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none") }),
  /** The answer names the next page: {cursor}. */
  z.strictObject({ type: z.literal("cursor"), path: pathSchema }),
  /** Numbered pages from `first`: {page}, with `size` postings each and the total at `total`. */
  z.strictObject({ type: z.literal("page"), size: z.number().int().min(1).max(100), total: pathSchema, first: z.number().int().min(0).max(1).default(1) }),
  /** By offset: {offset}, `size` at a time, the total at `total` when the portal says, and no further than `max`. */
  z.strictObject({ type: z.literal("offset"), size: z.number().int().min(1).max(100), total: pathSchema.optional(), max: z.number().int().min(1).optional() }),
]);

const requestSchema = {
  url: templateSchema,
  headers: z.record(z.string().min(1).max(100), templateSchema).default({}),
  params: z.array(paramSchema).max(30).default([]),
};

const searchSchema = z.strictObject({
  ...requestSchema,
  paging: pagingSchema.default({ type: "none" }),
  /**
   * Where the list of postings is: "data.jobs", "rss.channel.item", or "$"
   * for an answer that is the list. For `jobposting`, leave it out: every
   * JobPosting on the page is one.
   */
  items: pathSchema.optional(),
  /** Whether a missing list means no postings rather than a changed answer. */
  itemsMayBeMissing: z.boolean().default(false),
  /**
   * For a portal that returns everything (a feed, a careers page): keep only
   * the postings with every word of the search in the title or company, in
   * the place, remote when asked, workable from the country, and recent enough.
   */
  localFilter: z.boolean().default(false),
  /**
   * Minutes one answer is kept and shared by every search (a feed read whole,
   * as its terms ask: one download an hour, four a day), up to a day.
   */
  keepMinutes: z.number().int().min(0).max(1440).default(0),
  /** Asks once for each entry of a list field, `atOnce` at a time, with the entry as {each}; the answers are one page. */
  each: z.strictObject({ field: z.string().max(40), atOnce: z.number().int().min(1).max(8).default(4) }).optional(),
  posting: postingSpecSchema.optional(),
});

const detailsSchema = z.discriminatedUnion("type", [
  /** The search results have all there is. */
  z.strictObject({ type: z.literal("none") }),
  /** The posting's own page, read like Fetch reads a link, with nothing from the fields. */
  z.strictObject({ type: z.literal("page") }),
  /** A request for one posting: {id}, with its description at `description`; then its page, when `thenPage`. */
  z.strictObject({ type: z.literal("request"), ...requestSchema, description: valueSpecSchema, thenPage: z.boolean().default(false) }),
]);

const fieldBase = {
  name: z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/, "A field name is letters and digits, starting with a lower-case letter."),
  label: z.string().min(1).max(60),
  help: z.string().max(300).optional(),
};

const fieldSchema = z.discriminatedUnion("type", [
  /** A key: encrypted, never exported, never shown again. */
  z.strictObject({ ...fieldBase, type: z.literal("secret"), required: z.boolean().default(true) }),
  z.strictObject({ ...fieldBase, type: z.literal("text"), required: z.boolean().default(true) }),
  /** One of a few options; an option can change the base address and add headers. */
  z.strictObject({
    ...fieldBase,
    type: z.literal("choice"),
    default: z.string().max(60),
    options: z
      .array(z.strictObject({ value: z.string().min(1).max(60), label: z.string().min(1).max(60), base: httpsUrl.optional(), headers: z.record(z.string().min(1).max(100), templateSchema).optional() }))
      .min(2)
      .max(10),
  }),
  /** The portal's address, for one the user runs themselves: its host may be reached too. */
  z.strictObject({ ...fieldBase, type: z.literal("server"), default: httpsUrl }),
  /**
   * A list the user fills in, one entry a line, such as companies' job board
   * names (E23, #238): `search.each` asks once for each entry. An entry is
   * letters, digits, dots, dashes and underscores.
   */
  z.strictObject({ ...fieldBase, type: z.literal("list"), required: z.boolean().default(true), max: z.number().int().min(1).max(50).default(25) }),
]);

const KINDS_OF_WORK = ["any", "tech"] as const;

export const portalConfigSchema = z
  .strictObject({
    format: z.literal(PORTAL_FORMAT),
    id: portalIdSchema,
    name: z.string().min(1).max(60),
    /** The config's own version, raised with every change: "1.0.0". */
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'A version is three numbers, such as "1.2.0".'),
    /** What it covers, in a line. */
    description: z.string().max(300),
    /** Cost and reach at a glance. */
    tag: z.string().max(120),
    /** The portal's terms of use. */
    termsUrl: httpsUrl.optional(),
    /** Where to get a key. */
    keyUrl: httpsUrl.nullable().default(null),
    /** ISO 3166-1 codes in lower case; null for every country. */
    countries: z
      .array(z.string().regex(/^[a-z]{2}$/))
      .min(1)
      .nullable(),
    kinds: z.array(z.enum(KINDS_OF_WORK)).min(1),
    /** Whether it lists only remote jobs. */
    remoteOnly: z.boolean().default(false),
    /** Whether it looks within a distance of the place. */
    radius: z.boolean(),
    /** Every host it may reach. */
    hosts: z.array(hostSchema).min(1).max(10),
    /** The address its requests start from: {base}. A choice or server field can replace it. */
    base: httpsUrl.optional(),
    fields: z.array(fieldSchema).max(10).default([]),
    /** When used-up searches come back: "this month", "today". */
    quota: z.strictObject({ period: z.string().min(1).max(40) }).nullable().default(null),
    /** Shown with its postings, as its terms ask: text, linked to `link` or to its own site for the posting's country (`localHosts`, "www.adzuna.*"). */
    credit: z
      .strictObject({ text: z.string().min(1).max(60), link: httpsUrl.optional(), localHosts: z.string().regex(/^[a-z0-9.*-]+$/).max(100).optional() })
      .nullable()
      .default(null),
    /** A note the user must accept before it's searched. */
    consent: z.strictObject({ note: z.string().min(1).max(1000) }).nullable().default(null),
    /** A posting's own page on the portal, which its results always link to: "https://example.com/job/{id}". */
    postingPage: templateSchema.nullable().default(null),
    /** Seconds to wait for an answer: 2 minutes unless it says less (S3). */
    timeoutSeconds: z.number().int().min(1).max(120).default(120),
    /** Seconds to leave between two requests. */
    minGapSeconds: z.number().min(0).max(60).default(0),
    /** The biggest answer it reads, in megabytes: 5 unless it says more (a company's whole board can be bigger). */
    maxMegabytes: z.number().int().min(1).max(25).default(5),
    /** Tables for `{name|map:table}` and `map: "table"`. */
    maps: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/), z.record(z.string().max(100), z.string().max(200))).default({}),
    /** How its answers come: JSON, an RSS or Atom feed, or a page with schema.org JobPosting data. */
    kind: z.enum(["json", "feed", "jobposting"]),
    search: searchSchema,
    details: detailsSchema.default({ type: "none" }),
    /** The smallest search that shows the portal answers and takes the key. */
    test: z.strictObject({ keywords: z.string().min(1).max(100), place: z.string().max(100).default(""), country: z.string().regex(/^[a-z]{2}$/) }),
  })
  .superRefine((config, issue) => {
    const listed = new Set(config.hosts);
    const reached = [config.base, ...config.fields.flatMap((field) => (field.type === "choice" ? field.options.map((option) => option.base) : []))];
    for (const address of reached) {
      if (address && !listed.has(new URL(address).hostname)) issue.addIssue({ code: "custom", message: `${new URL(address).hostname} isn't in hosts.`, path: ["hosts"] });
    }
    if (config.kind !== "jobposting" && !config.search.items) issue.addIssue({ code: "custom", message: "Say where the list of postings is.", path: ["search", "items"] });
    if (config.search.each) {
      if (config.fields.find((field) => field.name === config.search.each!.field)?.type !== "list") issue.addIssue({ code: "custom", message: `${config.search.each.field} isn't a list field.`, path: ["search", "each", "field"] });
      if (config.search.paging.type !== "none") issue.addIssue({ code: "custom", message: "A search for each entry has no pages.", path: ["search", "paging"] });
    }
    if (config.kind !== "jobposting" && !config.search.posting) issue.addIssue({ code: "custom", message: "Say where each part of a posting is.", path: ["search", "posting"] });
    const names = config.fields.map((field) => field.name);
    if (new Set(names).size !== names.length) issue.addIssue({ code: "custom", message: "Two fields have the same name.", path: ["fields"] });
    for (const { template, path } of templatesIn(config)) {
      for (const message of templateProblems(template, knownNames(config), config.maps as Tables)) issue.addIssue({ code: "custom", message, path });
    }
    for (const { condition, path } of conditionsIn(config)) {
      const name = conditionName(condition);
      if (name && !knownNames(config).has(name)) issue.addIssue({ code: "custom", message: `"${condition}" reads ${name}, which isn't a name a condition can use.`, path });
    }
  });

/** The names a config's templates and conditions may read. */
function knownNames(config: { fields: readonly { name: string }[]; search?: { each?: unknown } }): Set<string> {
  return new Set<string>([...QUERY_NAMES, ...PAGING_NAMES, ...OTHER_NAMES, ...config.fields.map((field) => `fields.${field.name}`), ...(config.search?.each ? [EACH_NAME] : [])]);
}

type Located<T> = T & { path: (string | number)[] };

function specTemplates(spec: ValueSpec | undefined, path: (string | number)[]): Located<{ template: string }>[] {
  if (spec === undefined || typeof spec === "string") return [];
  return [
    ...(spec.template ? [{ template: spec.template, path: [...path, "template"] }] : []),
    ...(spec.first ?? []).flatMap((part, index) => specTemplates(part, [...path, "first", index])),
    ...(spec.join ?? []).flatMap((part, index) => specTemplates(part, [...path, "join", index])),
  ];
}

type Shape = {
  fields: readonly ({ name: string; type: string; options?: readonly { headers?: Record<string, string> }[] })[];
  postingPage: string | null;
  search: { url: string; headers: Record<string, string>; params: readonly { value: string; when?: string | string[] }[]; posting?: Record<string, unknown> };
  details: { type: string; url?: string; headers?: Record<string, string>; params?: readonly { value: string; when?: string | string[] }[]; description?: ValueSpec };
};

/** Every template in a config, with where it is. */
function templatesIn(config: Shape): Located<{ template: string }>[] {
  const request = (part: { url?: string; headers?: Record<string, string>; params?: readonly { value: string }[] }, at: string[]) => [
    ...(part.url ? [{ template: part.url, path: [...at, "url"] }] : []),
    ...Object.entries(part.headers ?? {}).map(([name, template]) => ({ template, path: [...at, "headers", name] })),
    ...(part.params ?? []).map((param, index) => ({ template: param.value, path: [...at, "params", index, "value"] })),
  ];
  return [
    ...request(config.search, ["search"]),
    ...request(config.details, ["details"]),
    ...(config.postingPage ? [{ template: config.postingPage, path: ["postingPage"] }] : []),
    ...config.fields.flatMap((field, index) =>
      (field.options ?? []).flatMap((option, which) => Object.entries(option.headers ?? {}).map(([name, template]) => ({ template, path: ["fields", index, "options", which, "headers", name] }))),
    ),
    ...Object.entries(config.search.posting ?? {}).flatMap(([part, spec]) =>
      part === "salary" && spec && typeof spec === "object"
        ? Object.entries(spec).flatMap(([name, inner]) => specTemplates(inner as ValueSpec, ["search", "posting", part, name]))
        : specTemplates(spec as ValueSpec, ["search", "posting", part]),
    ),
    ...specTemplates(config.details.description, ["details", "description"]),
  ];
}

/** Every condition in a config, with where it is. */
function conditionsIn(config: Shape): Located<{ condition: string }>[] {
  const of = (params: readonly { when?: string | string[] }[] | undefined, at: string) =>
    (params ?? []).flatMap((param, index) => (param.when === undefined ? [] : (typeof param.when === "string" ? [param.when] : param.when).map((condition) => ({ condition, path: [at, "params", index, "when"] }))));
  return [...of(config.search.params, "search"), ...of(config.details.params, "details")];
}

export type PortalConfig = z.output<typeof portalConfigSchema>;

/** A config, checked; or what's wrong with it, one line per problem, each with where it is. */
export function parsePortalConfig(input: unknown): { ok: true; config: PortalConfig } | { ok: false; problems: string[] } {
  const parsed = portalConfigSchema.safeParse(input);
  if (parsed.success) return { ok: true, config: parsed.data };
  return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`) };
}
