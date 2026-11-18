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

export type StartupStatusName = "NEW" | "SAVED" | "CONTACTED" | "DISMISSED";

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
type StartupLink = z.infer<typeof startupLinkSchema>;

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

/** A reason a startup fits, or a red flag (good: false). */
export type StartupReason = { text: string; good: boolean };

/** A startup as the screen sees it. */
export type StartupView = FoundStartup & {
  id: string;
  /** 0–100: how well it fits the profile it fits best. */
  score: number;
  /** Why: the keyword match's reasons are all good; the scoring model's (#524) can be red flags. */
  reasons: StartupReason[];
  /** Scored with the model in Settings → Scoring (#524), not the keyword match. */
  aiScored: boolean;
  /** The profile it fits best (E24-6), which the score is for. */
  profileId: string | null;
  status: StartupStatusName;
  /** Where its site says it takes no unsolicited applications; "" when it doesn't. */
  noApplicationsFrom: string;
  emailsCheckedAt: string | null;
  peopleCheckedAt: string | null;
  notes: string;
  /** The application started from it, if any. */
  applicationId: string | null;
  /** "hires from the Netherlands" (E32-4), worked out for the profile's country when the list loads; "" otherwise. */
  hiresFrom?: string;
};

/** Where to look: anywhere, the profile's city, its country, or remote work open to it. */
const STARTUP_PLACES = ["any", "city", "country", "remote"] as const;

const STARTUP_SORTS = ["match", "newest"] as const;

/**
 * The tabs (E32-4, PL1, decided 17 November 2026): Hiring now is every
 * startup not dismissed; Applied for is one with an application or that was
 * contacted.
 */
export const STARTUP_VIEWS = ["HIRING", "NEW", "SAVED", "APPLIED", "DISMISSED"] as const;
export type StartupViewName = (typeof STARTUP_VIEWS)[number];
export const STARTUP_VIEW_LABELS: Record<StartupViewName, string> = { HIRING: "Hiring now", NEW: "New", SAVED: "Saved", APPLIED: "Applied for", DISMISSED: "Dismissed" };

export const startupFilterSchema = z.object({
  q: z.string().trim().max(200).default(""),
  place: z.enum(STARTUP_PLACES).default("any"),
  source: z.enum(STARTUP_SOURCES).or(z.literal("")).default(""),
  withEmail: z.boolean().default(false),
  view: z.enum(STARTUP_VIEWS).default("HIRING"),
  sort: z.enum(STARTUP_SORTS).default("match"),
});
export type StartupFilter = z.output<typeof startupFilterSchema>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The filter in the Startups screen's address; ?view=contacted from before is Applied for. */
export function startupFilterFromParams(params: Record<string, string | string[] | undefined>): StartupFilter {
  const view = one(params.view).toUpperCase();
  const parsed = startupFilterSchema.safeParse({
    q: one(params.q),
    place: one(params.place) || undefined,
    source: one(params.source).toUpperCase(),
    withEmail: one(params.email) === "1",
    view: view === "CONTACTED" ? "APPLIED" : view || undefined,
    sort: one(params.sort) || undefined,
  });
  return parsed.success ? parsed.data : startupFilterSchema.parse({});
}

/** The Startups screen's address for a filter, leaving out the defaults. */
export function startupFilterHref(filter: StartupFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.place !== "any") params.set("place", filter.place);
  if (filter.source) params.set("source", filter.source.toLowerCase());
  if (filter.withEmail) params.set("email", "1");
  if (filter.view !== "HIRING") params.set("view", filter.view.toLowerCase());
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
