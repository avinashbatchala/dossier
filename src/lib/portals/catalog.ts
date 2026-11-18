import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import { checkRuns, waitSeconds } from "@/lib/announcements/check";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";

import { parsePortalConfig, type PortalConfig } from "./format";

// The portal catalog (E23-2, #398): the configs reviewed in the public
// dossier-portals repository, as the project's backend serves them at
// GET /v1/portals (dossier-admin's docs/api-v1.md, copied in
// src/lib/announcements/api-v1.schema.json). Read like the announcements:
// anonymously, with an ETag, at most once a day and when Browse portals
// opens. The last catalog is kept, and a backend that's down, slow or wrong
// changes nothing.

type Db = Prisma.TransactionClient | typeof prisma;

const API_URL = "https://api.dossier.aien.me/v1";
const TIMEOUT_MS = 10_000;
/** Far more than a full catalog, so a wrong answer can't use up the server's memory. */
const MAX_BYTES = 5 * 1024 * 1024;
const DAY_SECONDS = 24 * 60 * 60;
/** Browse portals asks again at most this often, however often it's opened. */
const BROWSE_GAP_MS = 60_000;

/** A catalog entry as served; its config is read with the app's own format. */
const entrySchema = z.object({
  id: z.string(),
  version: z.string(),
  name: z.string(),
  description: z.string().catch(""),
  countries: z.array(z.string()).nullable(),
  kinds: z.array(z.string()),
  access: z.string(),
  needsKey: z.boolean(),
  builtIn: z.boolean().catch(false),
  termsUrl: z.string().catch(""),
  config: z.unknown(),
});

const withdrawnSchema = z.object({ id: z.string(), reason: z.string(), withdrawnAt: z.string() });

/** A portal in the catalog whose config this Dossier can read. */
export type CatalogEntry = Omit<z.infer<typeof entrySchema>, "config"> & { config: PortalConfig };
export type WithdrawnPortal = z.infer<typeof withdrawnSchema>;

/**
 * The answer's portals and withdrawals; an entry that doesn't fit, or whose
 * config this Dossier can't read (a newer format), is left out. Null when the
 * answer isn't a catalog at all.
 */
export function parseCatalog(answer: unknown): { portals: CatalogEntry[]; withdrawn: WithdrawnPortal[]; commit: string | null } | null {
  const shape = z.object({ portals: z.array(z.unknown()), withdrawn: z.array(z.unknown()).catch([]), commit: z.string().nullable().catch(null) }).safeParse(answer);
  if (!shape.success) return null;
  const portals = shape.data.portals.flatMap((item) => {
    const entry = entrySchema.safeParse(item);
    if (!entry.success) return [];
    const config = parsePortalConfig(entry.data.config);
    if (!config.ok || config.config.id !== entry.data.id || config.config.version !== entry.data.version) return [];
    return [{ ...entry.data, config: config.config }];
  });
  const withdrawn = shape.data.withdrawn.flatMap((item) => {
    const entry = withdrawnSchema.safeParse(item);
    return entry.success ? [entry.data] : [];
  });
  return { portals, withdrawn, commit: shape.data.commit };
}

type Answer = { status: "new"; portals: unknown; withdrawn: unknown; commit: string | null; etag: string | null; wait: number } | { status: "same"; wait: number } | { status: "failed" };

/** One request, which carries nothing about this install. Never throws. */
async function askBackend(etag: string | null, fetchImpl: typeof fetch, base: string): Promise<Answer> {
  try {
    const response = await fetchImpl(`${base}/portals`, {
      headers: { accept: "application/json", "user-agent": "Dossier", ...(etag ? { "if-none-match": etag } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // A day unless the answer says otherwise, within the announcements' limits.
    const wait = response.headers.get("cache-control") ? waitSeconds(response.headers.get("cache-control")) : DAY_SECONDS;
    if (response.status === 304) return { status: "same", wait };
    if (!response.ok) return { status: "failed" };
    if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return { status: "failed" };
    const text = await response.text();
    if (text.length > MAX_BYTES) return { status: "failed" };
    const catalog = parseCatalog(JSON.parse(text));
    if (!catalog) return { status: "failed" };
    return { status: "new", portals: catalog.portals.map(({ config, ...entry }) => ({ ...entry, config })), withdrawn: catalog.withdrawn, commit: catalog.commit, etag: response.headers.get("etag"), wait };
  } catch {
    // Offline, blocked, slow or not JSON: it tries again later, without filling the logs.
    return { status: "failed" };
  }
}

const secondsAfter = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000);

const globalForCatalog = globalThis as unknown as { catalogReading?: Promise<string> };

type ReadOptions = { now?: Date; fetchImpl?: typeof fetch; base?: string; force?: boolean; db?: Db };

/**
 * Reads the catalog when it's due, or now for Browse portals (`force`, at
 * most once a minute), and keeps it. When to ask next is saved before asking,
 * so a backend that fails isn't asked on every page.
 */
export async function readCatalog({ now = new Date(), fetchImpl = fetch, base = env.DOSSIER_API_URL ?? API_URL, force = false, db = prisma }: ReadOptions = {}): Promise<"read" | "same" | "skipped" | "failed"> {
  if (!checkRuns() && !force) return "skipped";
  // Pages loading together share one read.
  if (globalForCatalog.catalogReading) return (await globalForCatalog.catalogReading) as "read";
  const reading = (async () => {
    const row = await db.portalCatalog.findUnique({ where: { id: 1 } });
    const due = !row?.nextReadAt || row.nextReadAt <= now || row.nextReadAt.getTime() > now.getTime() + 7 * DAY_SECONDS * 1000;
    const recent = row?.readAt && now.getTime() - row.readAt.getTime() < BROWSE_GAP_MS;
    if (force ? recent : !due) return "skipped" as const;
    await db.portalCatalog.upsert({ where: { id: 1 }, create: { id: 1, nextReadAt: secondsAfter(now, DAY_SECONDS) }, update: { nextReadAt: secondsAfter(now, DAY_SECONDS) } });
    const answer = await askBackend(row?.etag ?? null, fetchImpl, base);
    if (answer.status === "failed") return "failed" as const;
    const nextReadAt = secondsAfter(now, answer.wait);
    if (answer.status === "same") {
      await db.portalCatalog.update({ where: { id: 1 }, data: { nextReadAt, readAt: now } });
      return "same" as const;
    }
    await db.portalCatalog.update({
      where: { id: 1 },
      data: { portals: answer.portals as Prisma.InputJsonValue, withdrawn: answer.withdrawn as Prisma.InputJsonValue, commit: answer.commit, etag: answer.etag, readAt: now, nextReadAt },
    });
    return "read" as const;
  })();
  globalForCatalog.catalogReading = reading;
  try {
    return await reading;
  } finally {
    globalForCatalog.catalogReading = undefined;
  }
}

/** The catalog as last read: every portal this Dossier can read, and the withdrawn ones. */
export async function loadCatalog(db: Db = prisma): Promise<{ portals: CatalogEntry[]; withdrawn: WithdrawnPortal[]; readAt: Date | null }> {
  const row = await db.portalCatalog.findUnique({ where: { id: 1 } });
  const parsed = parseCatalog({ portals: row?.portals ?? [], withdrawn: row?.withdrawn ?? [], commit: row?.commit ?? null });
  return { portals: parsed?.portals ?? [], withdrawn: parsed?.withdrawn ?? [], readAt: row?.readAt ?? null };
}

/** A value as text with every object's keys in order, so two configs compare equal however they were stored (JSONB reorders keys). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether a config is exactly one the catalog lists as reviewed: the same id, version and contents. */
export async function isReviewed(config: PortalConfig, db: Db = prisma): Promise<boolean> {
  const { portals } = await loadCatalog(db);
  const entry = portals.find((portal) => portal.id === config.id && portal.version === config.version);
  return entry !== undefined && canonical(entry.config) === canonical(config);
}

/** Run after each page load, when a read is due. Never throws. */
export async function readCatalogIfDue(): Promise<void> {
  // A read that brought something new may have withdrawn or updated a portal in use (E26-5).
  if ((await readCatalog().catch(() => "failed" as const)) !== "read") return;
  const { notifyPortalChanges } = await import("./notices");
  await notifyPortalChanges().catch((error: unknown) => logServerError("portal notices", error));
}


/** A catalog entry as Browse portals shows it (E23-4): plain values, and where it stands on this install. */
export type CatalogPortalView = {
  id: string;
  name: string;
  version: string;
  description: string;
  countries: string[] | null;
  kinds: string[];
  access: string;
  needsKey: boolean;
  builtIn: boolean;
  termsUrl: string;
  hosts: string[];
  asks: string[];
  /** Whether it lists only remote jobs. */
  remoteOnly: boolean;
  /** Whether it needs a list filled in before it can search, such as companies' boards (E23, #238). */
  needsList: boolean;
  /** On this install: comes with it, added already (at which version), or not yet. */
  state: "built-in" | "added" | "available";
  installedVersion: string | null;
};

export type CatalogView = { portals: CatalogPortalView[]; readAt: string | null };

/** The catalog for Browse portals, each entry with where it stands on this install. */
export async function catalogView(installed: ReadonlyMap<string, string>, builtIns: ReadonlySet<string>, db: Db = prisma): Promise<CatalogView> {
  const { portals, withdrawn, readAt } = await loadCatalog(db);
  const gone = new Set(withdrawn.map((entry) => entry.id));
  return {
    readAt: readAt?.toISOString() ?? null,
    portals: portals
      .filter((portal) => !gone.has(portal.id))
      .map(({ config, ...entry }) => ({
        ...entry,
        countries: entry.countries ? [...entry.countries] : null,
        kinds: [...entry.kinds],
        hosts: [...config.hosts],
        asks: config.fields.filter((field) => field.type !== "server").map((field) => field.label),
        remoteOnly: config.remoteOnly,
        needsList: config.fields.some((field) => field.type === "list" && field.required),
        state: builtIns.has(entry.id) ? "built-in" : installed.has(entry.id) ? "added" : "available",
        installedVersion: installed.get(entry.id) ?? null,
      })),
  };
}
