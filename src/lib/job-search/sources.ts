import { BUILT_IN_PORTALS, builtInPortal } from "@/lib/portals/built-in";
import type { PortalConfig } from "@/lib/portals/format";
import { fill } from "@/lib/portals/template";

import type { JobSource, JSearchHost } from "./search";

/** What Settings → Job search may know about a source's key: never the key itself. "env" means it comes from the environment. */
export type JobKeyState = "none" | "set" | "unreadable" | "env";

/** A portal's field as Settings → Job search shows it: never a key, only whether there is one. */
export type PortalFieldView =
  | { name: string; label: string; type: "secret"; keyState: JobKeyState; envName: string | null }
  | { name: string; label: string; type: "text"; value: string }
  | { name: string; label: string; type: "choice"; value: string; options: { value: string; label: string }[] }
  /** One entry a line, such as companies' job boards (E23, #238). */
  | { name: string; label: string; type: "list"; value: string; max: number; help: string | null };

/** A portal in Settings → Job search (E22-3): what it is, whether it's on, and its fields. */
export type PortalView = Pick<SourceInfo, "name" | "description" | "tag" | "keyUrl" | "quotaPeriod" | "countries" | "kinds"> & {
  id: JobSource;
  on: boolean;
  /** A portal the user added (E23-3): where it came from, whether it's reviewed, and its terms; null for a built-in. */
  installed: { origin: "file" | "link" | "catalog"; reviewed: boolean; termsUrl: string | null } | null;
  /** Its config's version as in use. */
  version: string;
  /** When the catalog withdrew it (E23-5): why, and whether it's paused until the user keeps it. */
  withdrawal: { reason: string; withdrawnAt: string; paused: boolean } | null;
  /** A newer version in the catalog (E23-5): what changed, and the new hosts to approve. */
  update: { from: string; to: string; newHosts: string[]; changes: string[] } | null;
  /** The note to accept before it's searched (the Bundesagentur's), and when it was. */
  consent: string | null;
  acceptedAt: string | null;
  fields: PortalFieldView[];
};

/** What the Job search section starts from (E14-4, E22-3): the portals this server offers. */
export type JobSearchSettingsView = {
  portals: PortalView[];
  /** The FreeHire it searches: "freehire.me", or a self-hosted one's host (DOSSIER_FREEHIRE_URL). */
  freehire: { host: string };
};

/** Where to get a JSearch key, by where it's from. */
export const JSEARCH_KEY_URLS: Record<JSearchHost, string> = {
  openwebninja: "https://www.openwebninja.com/api/jsearch",
  rapidapi: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch",
};

/** How Settings → Job search and the Find jobs screen describe each source (E14). */
export type SourceInfo = {
  name: string;
  /** What it covers, in a line. */
  description: string;
  /** Cost and reach at a glance. */
  tag: string;
  /** Where to get a key; null when none is needed. */
  keyUrl: string | null;
  /** When used-up searches come back: "this month", "today"; null when there's no quota. */
  quotaPeriod: string | null;
  /** Shown with its results, as the source's terms ask. */
  attribution: string | null;
  /**
   * Where the attribution links, when the terms ask for a link: the source's
   * site for the posting's country when its link is on one (`local`), else
   * `home`. Null for a plain-text attribution.
   */
  attributionLink: { home: string; local: RegExp } | null;
  /** The countries it lists jobs in (ISO codes); null for every country. */
  countries: readonly string[] | null;
  /** Whether it looks within a distance of the place; without, the place only puts postings there first. */
  radius: boolean;
  /** The kinds of work it lists ("any", "tech", ...), for the setup guide (E22-9). */
  kinds: readonly string[];
};

/** "www.adzuna.*" as a pattern: the star is a top-level domain, with or without a second level ("de", "co.uk", "com.au"). */
function hostPattern(glob: string | undefined): RegExp {
  if (!glob) return /^$/;
  const escaped = glob.split("*").map((part) => part.replace(/[.]/g, "\\.")).join("[a-z]{2,3}(?:\\.[a-z]{2})?");
  return new RegExp(`^${escaped}$`);
}

function infoOf(config: PortalConfig): SourceInfo {
  return {
    name: config.name,
    description: config.description,
    tag: config.tag,
    keyUrl: config.keyUrl,
    quotaPeriod: config.quota?.period ?? null,
    attribution: config.credit?.text ?? null,
    attributionLink: config.credit?.link ? { home: config.credit.link, local: hostPattern(config.credit.localHosts) } : null,
    countries: config.countries,
    radius: config.radius,
    kinds: config.kinds,
  };
}

/** Each built-in source, as its config (src/lib/portals/built-in) describes it. */
export const SOURCE_INFO: Readonly<Record<string, SourceInfo>> = Object.fromEntries(BUILT_IN_PORTALS.map((config) => [config.id, infoOf(config)]));

/**
 * A portal the user added (E23-3), as the browser gets to know it: plain
 * values from its config, sent by the page (PortalRegistry), since a config's
 * credit pattern can't cross to the browser.
 */
export type PortalInfo = {
  id: string;
  name: string;
  description: string;
  tag: string;
  keyUrl: string | null;
  quota: { period: string } | null;
  credit: { text: string; link?: string; localHosts?: string } | null;
  countries: string[] | null;
  radius: boolean;
  kinds: string[];
  postingPage: string | null;
  maps: Record<string, Record<string, string>>;
};

/** An installed portal's config as the browser may know it. */
export const portalInfo = (config: PortalConfig): PortalInfo => ({
  id: config.id,
  name: config.name,
  description: config.description,
  tag: config.tag,
  keyUrl: config.keyUrl,
  quota: config.quota,
  credit: config.credit,
  countries: config.countries ? [...config.countries] : null,
  radius: config.radius,
  kinds: [...config.kinds],
  postingPage: config.postingPage,
  maps: config.maps,
});

/** The installed portals known here: on the server once they're read (src/lib/portals/installed.ts), in the browser from the page. */
const INSTALLED = new Map<string, { info: SourceInfo; plain: PortalInfo }>();

/** Built-ins' updates from the catalog (E23-5), which describe them instead of the bundled configs. */
const UPDATED = new Map<string, { info: SourceInfo; plain: PortalInfo }>();

/** Replaces what's known about installed portals; one with a built-in's id is that built-in's update. */
export function rememberInstalledPortals(portals: readonly PortalInfo[]): void {
  INSTALLED.clear();
  UPDATED.clear();
  for (const plain of portals) {
    const entry = { plain, info: infoOf({ ...plain, quota: plain.quota } as unknown as PortalConfig) };
    (Object.hasOwn(SOURCE_INFO, plain.id) ? UPDATED : INSTALLED).set(plain.id, entry);
  }
}

/** Whether a stored source id is one Dossier can still search (#269): a built-in, or a portal the user added. */
export const isJobSource = (id: string): id is JobSource => Object.hasOwn(SOURCE_INFO, id) || INSTALLED.has(id);

/** Every portal Dossier has, built-ins first, by id and name: the Portal filter's choices. */
export const knownPortals = (): { id: string; name: string }[] => [
  ...Object.entries(SOURCE_INFO).map(([id, info]) => ({ id, name: UPDATED.get(id)?.info.name ?? info.name })),
  ...[...INSTALLED.values()].map(({ plain }) => ({ id: plain.id, name: plain.name })),
];

/**
 * A source's info, for any stored id: a source that's no longer listed
 * (#269), or a portal that was removed, keeps its id as its name, covers no
 * country and has nothing else.
 */
export function sourceInfo(id: string): SourceInfo {
  if (id === PASTED_SOURCE) return { ...unlisted(id), name: "Pasted", description: "Pasted into New application and saved for later." };
  const updated = UPDATED.get(id);
  if (updated) return updated.info;
  if (Object.hasOwn(SOURCE_INFO, id)) return SOURCE_INFO[id];
  const installed = INSTALLED.get(id);
  if (installed) return installed.info;
  return unlisted(id);
}

const unlisted = (id: string): SourceInfo => ({ name: id, description: "", tag: "", keyUrl: null, quotaPeriod: null, attribution: null, attributionLink: null, countries: [], radius: false, kinds: [] });

/** The source of a posting pasted into New application and saved for later (E31-3, decided 17 November 2026): no portal searches it. */
export const PASTED_SOURCE = "PASTED";

/** FreeHire's public catalogue; DOSSIER_FREEHIRE_URL can name a self-hosted one instead. */
export const FREEHIRE_URL = (builtInPortal("FREEHIRE")!.fields.find((field) => field.type === "server") as { default: string }).default;

/** "JSearch", "JSearch and Adzuna", "JSearch, Adzuna and FreeHire". */
export function portalNames(ids: readonly string[]): string {
  const names = ids.map((id) => sourceInfo(id).name);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** Whether a source lists jobs in a country ("de"). */
export function sourceCovers(source: JobSource, country: string): boolean {
  const countries = sourceInfo(source).countries;
  return countries === null || countries.includes(country);
}

// The Bundesagentur für Arbeit (#223) has no official API: Dossier uses the
// access its own job search uses, without its permission. So it's the
// user's own choice, after this note, and a server can turn it off
// (DOSSIER_JOBS_ARBEITSAGENTUR=off).

/** The BA's terms of use for arbeitsagentur.de. */
export const ARBEITSAGENTUR_TERMS_URL = builtInPortal("ARBEITSAGENTUR")!.termsUrl!;

/** What "I understand" agrees to, in Settings, in Find jobs and in the server log. */
export const ARBEITSAGENTUR_NOTE = builtInPortal("ARBEITSAGENTUR")!.consent!.note;

/**
 * A posting's own page on its portal, which its results always link to even
 * when they have a link of their own (the BA's on arbeitsagentur.de); null
 * for a portal without one.
 */
export function postingPage(posting: { source: string; externalId: string }): string | null {
  const config = UPDATED.get(posting.source)?.plain ?? builtInPortal(posting.source) ?? INSTALLED.get(posting.source)?.plain;
  return config?.postingPage ? fill(config.postingPage, { id: posting.externalId }, config.maps) : null;
}

/** Where a posting's attribution links (www.adzuna.de for one of Adzuna's German postings); null when it's plain text. */
export function attributionHref(source: string, postingUrl: string): string | null {
  const link = sourceInfo(source).attributionLink;
  if (!link) return null;
  const host = URL.canParse(postingUrl) ? new URL(postingUrl) : null;
  return host?.protocol === "https:" && link.local.test(host.hostname) ? host.origin : link.home;
}
