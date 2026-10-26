import { z } from "zod";

// Startups (#222): startups that are hiring, from YC startups' job posts on
// Hacker News and Hacker News' monthly "Who is hiring?" thread, ranked
// against the profile, with the addresses they publish for applications.
// Shared by the server and the screen.

export const STARTUP_SOURCES = ["YC", "HN"] as const;
export type StartupSource = (typeof STARTUP_SOURCES)[number];

export const STARTUP_SOURCE_INFO: Record<StartupSource, { name: string; kind: string }> = {
  YC: { name: "Y Combinator", kind: "Job post" },
  HN: { name: "Hacker News", kind: "Who is hiring?" },
};

export const STARTUP_STATUSES = ["NEW", "SAVED", "CONTACTED", "DISMISSED"] as const;
export type StartupStatusName = (typeof STARTUP_STATUSES)[number];

/** What an address is for: an application address, the founders', a general one, or someone's own. */
export const EMAIL_LABELS = ["Hiring", "Founders", "General", "Person"] as const;
export type EmailLabel = (typeof EMAIL_LABELS)[number];

export const startupEmailSchema = z.object({
  email: z.string().max(200).regex(/^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i),
  label: z.enum(EMAIL_LABELS).catch("General"),
  /** Where it was published: a page of the startup's site, or the post. */
  from: z.string().max(500).catch(""),
  /**
   * Someone's own address found on the startup's site when the user asked
   * ("Look for people's addresses"); dropped after a while unless the user
   * wrote to the startup. Addresses a post gives for applying aren't.
   */
  onRequest: z.boolean().catch(false),
  /** When it was found (ISO). */
  foundAt: z.string().max(40).catch(""),
});
export type StartupEmail = z.infer<typeof startupEmailSchema>;

/**
 * The address to write to about a startup's application: its application
 * address first, then the founders', a general one, or someone's own; ""
 * when it publishes none. `emails` is the stored JSON list.
 */
export function startupAddress(emails: unknown): string {
  const list = startupEmailSchema.array().catch([]).parse(emails ?? []);
  return [...list].sort((a, b) => EMAIL_LABELS.indexOf(a.label) - EMAIL_LABELS.indexOf(b.label))[0]?.email ?? "";
}

export const startupLinkSchema =z.object({ label: z.string().max(60), url: z.string().max(2000).regex(/^https?:\/\//i) });
export type StartupLink = z.infer<typeof startupLinkSchema>;

/** A startup as a source found it. */
export type FoundStartup = {
  source: StartupSource;
  externalId: string;
  company: string;
  website: string;
  summary: string;
  details: string;
  location: string;
  remote: boolean | null;
  stage: string;
  roles: string[];
  emails: StartupEmail[];
  links: StartupLink[];
  postedAt: string | null;
};

/** A startup as the screen sees it. */
export type StartupView = FoundStartup & {
  id: string;
  score: number;
  reasons: string[];
  status: StartupStatusName;
  /** Where its site says it takes no unsolicited applications; "" when it doesn't. */
  noApplicationsFrom: string;
  emailsCheckedAt: string | null;
  peopleCheckedAt: string | null;
  notes: string;
  /** The application started from it, if any. */
  applicationId: string | null;
};

/** Where to look: anywhere, the profile's city, its country, or remote work open to it. */
export const STARTUP_PLACES = ["any", "city", "country", "remote"] as const;
export type StartupPlace = (typeof STARTUP_PLACES)[number];
/** Where the screen looks unless the filter says otherwise: the profile's country, or anywhere when it has none. */
export const DEFAULT_STARTUP_PLACE: StartupPlace = "country";

export const STARTUP_SORTS = ["match", "newest"] as const;

export const startupFilterSchema = z.object({
  q: z.string().trim().max(200).default(""),
  place: z.enum(STARTUP_PLACES).default(DEFAULT_STARTUP_PLACE),
  source: z.enum(STARTUP_SOURCES).or(z.literal("")).default(""),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  withEmail: z.boolean().default(false),
  status: z.enum(STARTUP_STATUSES).default("NEW"),
  sort: z.enum(STARTUP_SORTS).default("match"),
});
export type StartupFilter = z.output<typeof startupFilterSchema>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The filter in the Startups screen's address. */
export function startupFilterFromParams(
  params: Record<string, string | string[] | undefined>,
  { defaultPlace = DEFAULT_STARTUP_PLACE }: { defaultPlace?: StartupPlace } = {},
): StartupFilter {
  const parsed = startupFilterSchema.safeParse({
    q: one(params.q),
    place: one(params.place) || defaultPlace,
    source: one(params.source).toUpperCase(),
    minScore: one(params.min) || undefined,
    withEmail: one(params.email) === "1",
    status: one(params.view).toUpperCase() || undefined,
    sort: one(params.sort) || undefined,
  });
  return parsed.success ? parsed.data : startupFilterSchema.parse({ place: defaultPlace });
}

/** The Startups screen's address for a filter, leaving out the defaults. */
export function startupFilterHref(filter: StartupFilter, { defaultPlace = DEFAULT_STARTUP_PLACE }: { defaultPlace?: StartupPlace } = {}): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.place !== defaultPlace) params.set("place", filter.place);
  if (filter.source) params.set("source", filter.source.toLowerCase());
  if (filter.minScore > 0) params.set("min", String(filter.minScore));
  if (filter.withEmail) params.set("email", "1");
  if (filter.status !== "NEW") params.set("view", filter.status.toLowerCase());
  if (filter.sort !== "match") params.set("sort", filter.sort);
  const query = params.toString();
  return query ? `/startups?${query}` : "/startups";
}

const sourceResult = z.object({ source: z.enum(STARTUP_SOURCES), found: z.number().int(), error: z.string().nullable() });

/** What the last refresh found, kept in Settings (startupsLastRefresh) for the screen. */
export const startupsRefreshSchema = z.object({
  at: z.string(),
  added: z.number().int(),
  sources: z.array(sourceResult),
  /** Startups whose site gave at least one new address. */
  emailsFound: z.number().int(),
});
export type StartupsRefresh = z.infer<typeof startupsRefreshSchema>;
