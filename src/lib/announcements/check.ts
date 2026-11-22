import "server-only";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import type { SettingsData } from "@/lib/settings";
import { appVersion } from "@/lib/version";

import { parseAnnouncements, type Announcement, type AnnouncementFeed } from "./contract";

// Asks the project's backend for its current notices, on page load while
// someone is using Dossier, as update-check.ts does with GitHub. The request
// says nothing about this install: the notices that apply are chosen here. A
// backend that's down, slow or wrong changes nothing: the last good answer stays.

const API_URL = "https://api.dossier.aien.me/v1";
const TIMEOUT_MS = 10_000;
/** Far more than a full answer, so a wrong one can't use up the server's memory. */
const MAX_BYTES = 1024 * 1024;

const HOUR = 60 * 60;
const MIN_WAIT_SECONDS = HOUR;
const MAX_WAIT_SECONDS = 7 * 24 * HOUR;
const DEFAULT_WAIT_SECONDS = 6 * HOUR;

/** How long the answer says to wait, within the limits; the default when it doesn't say. */
export function waitSeconds(cacheControl: string | null): number {
  const maxAge = cacheControl?.match(/(?:^|[\s,])max-age=(\d+)/i)?.[1];
  if (maxAge === undefined) return DEFAULT_WAIT_SECONDS;
  return Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, Number(maxAge)));
}

const secondsAfter = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000).toISOString();

/**
 * Whether it's time to ask. A date further away than the longest wait is wrong
 * (a clock that moved), so it counts as due. A development server asks on every
 * page, so what changes in a local backend shows without waiting for hours.
 */
export function checkDue(feed: AnnouncementFeed | null, now: Date, development = process.env.NODE_ENV === "development"): boolean {
  if (!feed || development) return true;
  const next = new Date(feed.nextCheckAt).getTime();
  return next <= now.getTime() || next > now.getTime() + MAX_WAIT_SECONDS * 1000;
}

/** Production servers ask; development servers only when pointed at a backend, and tests never do. */
export function checkRuns(): boolean {
  return process.env.NODE_ENV === "production" || env.DOSSIER_API_URL !== undefined;
}

type Answer =
  | { status: "new"; items: Announcement[]; etag: string | null; wait: number }
  | { status: "same"; wait: number }
  | { status: "failed" };

/** The answer as JSON, unless it's too big or isn't JSON. */
async function readJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const text = await response.text();
  if (text.length > MAX_BYTES) return null;
  return JSON.parse(text) as unknown;
}

/** One request, which carries nothing about this install. Never throws. */
export async function askBackend(etag: string | null, fetchImpl: typeof fetch = fetch, base = env.DOSSIER_API_URL ?? API_URL): Promise<Answer> {
  try {
    const response = await fetchImpl(`${base}/announcements`, {
      headers: { accept: "application/json", "user-agent": "Dossier", ...(etag ? { "if-none-match": etag } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const wait = waitSeconds(response.headers.get("cache-control"));
    if (response.status === 304) return { status: "same", wait };
    if (!response.ok) return { status: "failed" };
    const items = parseAnnouncements(await readJson(response));
    return items ? { status: "new", items, etag: response.headers.get("etag"), wait } : { status: "failed" };
  } catch {
    // Offline, blocked, slow or not JSON: it tries again later, without filling the logs.
    return { status: "failed" };
  }
}

const globalForCheck = globalThis as unknown as { announcementCheckRunning?: boolean };

type CheckOptions = { now?: Date; fetchImpl?: typeof fetch; current?: string; base?: string };

/**
 * Asks the backend if it's time to, and keeps the answer. When to ask next is
 * saved before asking, so one that fails isn't tried again on every page.
 */
export async function checkAnnouncements({ now = new Date(), fetchImpl = fetch, current = appVersion, base }: CheckOptions = {}): Promise<"checked" | "skipped" | "failed"> {
  // Set before anything async, so pages loading together don't ask twice.
  if (globalForCheck.announcementCheckRunning) return "skipped";
  globalForCheck.announcementCheckRunning = true;
  try {
    // Another page may have asked since this one's settings were read.
    const { announcementFeed: feed } = await loadSettings();
    if (!checkDue(feed, now)) return "skipped";
    const kept: AnnouncementFeed = feed ?? { items: [], etag: null, appVersion: current, nextCheckAt: now.toISOString() };
    await saveSettings({ announcementFeed: { ...kept, nextCheckAt: secondsAfter(now, DEFAULT_WAIT_SECONDS) } });

    const answer = await askBackend(kept.appVersion === current ? kept.etag : null, fetchImpl, base);
    if (answer.status === "failed") return "failed";
    const nextCheckAt = secondsAfter(now, answer.wait);
    await saveSettings({
      announcementFeed:
        answer.status === "same"
          ? { ...kept, nextCheckAt }
          : { items: answer.items, etag: answer.etag, appVersion: current, nextCheckAt },
    });
    return "checked";
  } finally {
    globalForCheck.announcementCheckRunning = false;
  }
}

/**
 * Run by the signed-in layout after each page load (see after()), with the
 * settings it read anyway, so a page costs nothing until a check is due. Never throws.
 */
export async function checkAnnouncementsIfDue(settings: Pick<SettingsData, "announcementFeed">): Promise<void> {
  if (!checkRuns() || !checkDue(settings.announcementFeed, new Date())) return;
  await checkAnnouncements().catch((error: unknown) => logServerError("announcements", error));
}
