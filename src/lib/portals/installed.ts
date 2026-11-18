import "server-only";

import { Agent, fetch as undiciFetch } from "undici";

import type { Prisma } from "@/generated/prisma/client";
import { readLimited } from "@/lib/job-search/http";
import { portalInfo, rememberInstalledPortals } from "@/lib/job-search/sources";
import { logServerError } from "@/lib/log";
import { isIP } from "node:net";

import { guardedLookup, isPublicAddress } from "@/lib/posting-fetch";
import { prisma } from "@/lib/prisma";

import { builtInPortal } from "./built-in";
import { parsePortalConfig, type PortalConfig } from "./format";
import { newerVersion } from "./version";

// Portals the user added (E23-3, #399), from a file, a link or the catalog:
// each kept as a pinned copy (InstalledPortal) that changes only when the
// user installs an update. They're read here and made known to the rest of
// the server (sourceInfo, isJobSource) and, through the page, the browser.

type Db = Prisma.TransactionClient | typeof prisma;

/** Where an installed portal came from. */
export type PortalOrigin = "file" | "link" | "catalog";

export type InstalledPortal = {
  config: PortalConfig;
  origin: PortalOrigin;
  originUrl: string | null;
  reviewed: boolean;
  installedAt: Date;
  /** A newer version of a built-in, from the catalog (E23-5): it replaces the bundled one until a release catches up. */
  builtIn: boolean;
};

/** The installed portals as last read, for the adapters. */
let known: InstalledPortal[] = [];

/**
 * Every installed portal, in the order they were added, and made known to
 * the rest of the server. A stored config that no longer reads (a newer
 * Dossier changed the format) is left out, logged. One with a built-in's id
 * is an update of it from the catalog (E23-5), kept only while it's newer
 * than the one this release bundles.
 */
export async function loadInstalledPortals(db: Db = prisma): Promise<InstalledPortal[]> {
  const rows = await db.installedPortal.findMany({ orderBy: { installedAt: "asc" } });
  known = rows.flatMap((row) => {
    const parsed = parsePortalConfig(row.config);
    if (!parsed.ok) {
      logServerError("installed portal", new Error(`${row.id} doesn't read: ${parsed.problems.slice(0, 3).join("; ")}`));
      return [];
    }
    if (parsed.config.id !== row.id) return [];
    const bundled = builtInPortal(parsed.config.id);
    if (bundled && (row.origin !== "catalog" || !newerVersion(parsed.config.version, bundled.version))) return [];
    return [{ config: parsed.config, origin: row.origin as PortalOrigin, originUrl: row.originUrl, reviewed: row.reviewed, installedAt: row.installedAt, builtIn: Boolean(bundled) }];
  });
  rememberInstalledPortals(known.map((portal) => portalInfo(portal.config)));
  return known;
}

/** A built-in's update from the catalog, as last read; undefined when the bundled one is in use. */
export const builtInUpdate = (id: string): PortalConfig | undefined => known.find((portal) => portal.builtIn && portal.config.id === id)?.config;

/** An installed portal's config, as last read; undefined for any other id. */
export const installedPortal = (id: string): PortalConfig | undefined => known.find((portal) => portal.config.id === id)?.config;

/** Keeps a portal as installed, its config pinned as it is now. */
export async function installPortal(config: PortalConfig, { origin, originUrl = null, reviewed = false }: { origin: PortalOrigin; originUrl?: string | null; reviewed?: boolean }, db: Db = prisma): Promise<void> {
  const data = { config: config as unknown as Prisma.InputJsonValue, version: config.version, origin, originUrl, reviewed };
  await db.installedPortal.upsert({ where: { id: config.id }, create: { id: config.id, ...data }, update: data });
  await loadInstalledPortals(db);
}

/** Removes an installed portal. What it found stays in Positions, under its id. */
export async function removeInstalledPortal(id: string, db: Db = prisma): Promise<boolean> {
  const { count } = await db.installedPortal.deleteMany({ where: { id } });
  await loadInstalledPortals(db);
  return count > 0;
}

/** A config file is small: anything bigger isn't one. */
export const MAX_CONFIG_BYTES = 200 * 1024;

/** What Add portal shows before installing (E23-3): what the portal is, what it reaches and asks for, and the config's text, installed as shown. */
export type PortalPreview = {
  text: string;
  id: string;
  name: string;
  version: string;
  description: string;
  countries: string[] | null;
  kinds: string[];
  /** Every host it may reach. */
  hosts: string[];
  /** What it asks the user for: "API key", "Application ID". */
  asks: string[];
  termsUrl: string | null;
  /** Whether the catalog lists it as reviewed; a config added from a file or a link isn't (E23-2 lists them). */
  reviewed: boolean;
  /** The version installed now, when it is: installing replaces it. */
  installedVersion: string | null;
};

/** A config's text, read as a portal config, or what's wrong with it in words. */
export function previewConfig(text: string): { ok: true; config: PortalConfig; preview: PortalPreview } | { ok: false; problems: string[] } {
  if (new TextEncoder().encode(text).length > MAX_CONFIG_BYTES) return { ok: false, problems: [`It's bigger than a portal config can be (${MAX_CONFIG_BYTES / 1024} KB).`] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["It isn't JSON: a portal config is a .json file."] };
  }
  const parsed = parsePortalConfig(json);
  if (!parsed.ok) return parsed;
  const { config } = parsed;
  if (builtInPortal(config.id)) return { ok: false, problems: [`id: ${config.id} is a portal Dossier comes with. Give this one an id of its own.`] };
  return {
    ok: true,
    config,
    preview: {
      text,
      id: config.id,
      name: config.name,
      version: config.version,
      description: config.description,
      countries: config.countries ? [...config.countries] : null,
      kinds: [...config.kinds],
      hosts: [...config.hosts],
      asks: config.fields.filter((field) => field.type !== "server").map((field) => field.label),
      termsUrl: config.termsUrl ?? null,
      reviewed: false,
      installedVersion: known.find((portal) => portal.config.id === config.id && !portal.builtIn)?.config.version ?? null,
    },
  };
}

let linkAgent: Agent | undefined;

/**
 * A config from a link, as text: https only, reached only on the public
 * internet, at most MAX_CONFIG_BYTES. Nothing about the user goes with it.
 */
export async function fetchConfigText(link: string): Promise<{ ok: true; text: string } | { ok: false; problem: string }> {
  const url = URL.canParse(link) ? new URL(link) : null;
  if (!url || url.protocol !== "https:") return { ok: false, problem: "Use an https:// link to the config file." };
  // The lookup isn't asked about addresses typed as IPs, or localhost.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if ((isIP(host) && !isPublicAddress(host)) || /(^|\.)localhost\.?$/i.test(host)) return { ok: false, problem: "Dossier doesn't read links on your own network." };
  try {
    const response = (await undiciFetch(url, {
      headers: { accept: "application/json, text/plain;q=0.9" },
      signal: AbortSignal.timeout(15_000),
      dispatcher: (linkAgent ??= new Agent({ connect: { lookup: guardedLookup } })),
    })) as unknown as Response;
    if (!response.ok) return { ok: false, problem: `The link answered with an error (HTTP ${response.status}).` };
    const text = await readLimited(response, MAX_CONFIG_BYTES);
    if (text === null) return { ok: false, problem: `It's bigger than a portal config can be (${MAX_CONFIG_BYTES / 1024} KB).` };
    return { ok: true, text };
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    return { ok: false, problem: code === "EPRIVATE" ? "Dossier doesn't read links on your own network." : "The link couldn't be read. Check it and try again." };
  }
}
