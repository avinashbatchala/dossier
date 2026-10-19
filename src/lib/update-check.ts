import "server-only";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import type { SettingsData } from "@/lib/settings";
import { appVersion } from "@/lib/version";
import { RELEASES_REPOSITORY, type Release } from "@/lib/releases";

// The update check (E10-9, SET-12, PRD §11): "Check for updates" in
// Settings → About, and once on each day Dossier is used while "Check for
// updates daily" is on. All it sends is a request for the project's latest
// GitHub release. The newest release it has seen is kept in Settings, and the
// sidebar tells the user about it while it's newer than this version.

export type UpdateCheck =
  | { status: "latest"; version: string }
  | { status: "newer"; version: string; url: string }
  | { status: "unknown" };

/** 1.10.0 is newer than 1.9.2; anything after "-" (a pre-release) is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (version: string) => version.replace(/^v/i, "").split("-")[0].split(".").map((part) => Number(part) || 0);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/** A release page is only ever linked on GitHub. */
const isReleasePage = (url: string) => url.startsWith(`https://github.com/${RELEASES_REPOSITORY}/`);

/**
 * Asks GitHub for the latest release; null when it can't tell (offline,
 * slow, or an answer that doesn't look like a release).
 */
export async function latestRelease(fetchImpl: typeof fetch = fetch, base = env.DOSSIER_UPDATES_TEST_BASE_URL): Promise<Release | null> {
  try {
    const response = await fetchImpl(`${base ?? "https://api.github.com"}/repos/${RELEASES_REPOSITORY}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "Dossier" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const release = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof release.tag_name !== "string" || typeof release.html_url !== "string" || !isReleasePage(release.html_url)) return null;
    return { version: release.tag_name.replace(/^v/i, ""), url: release.html_url };
  } catch {
    return null;
  }
}

/** What a release means for this version. */
export function updateStatus(release: Release | null, current = appVersion): UpdateCheck {
  if (!release) return { status: "unknown" };
  return isNewer(release.version, current) ? { status: "newer", ...release } : { status: "latest", version: current };
}

/** Asks for the latest release and keeps it, so the sidebar can tell the user. */
export async function checkForUpdate(fetchImpl: typeof fetch = fetch, current = appVersion): Promise<UpdateCheck> {
  const release = await latestRelease(fetchImpl);
  if (release) await saveSettings({ latestVersion: release.version, latestVersionUrl: release.url });
  return updateStatus(release, current);
}

/** The newer release this install knows of, if any. */
export function availableUpdate(
  settings: Pick<SettingsData, "latestVersion" | "latestVersionUrl">,
  current = appVersion,
): Release | null {
  const { latestVersion: version, latestVersionUrl: url } = settings;
  return version && url && isReleasePage(url) && isNewer(version, current) ? { version, url } : null;
}

/** The release the sidebar tells the user about: a newer one, unless "Not now" hid it (or a newer one still). */
export function updateNotice(
  settings: Pick<SettingsData, "latestVersion" | "latestVersionUrl" | "updateDismissed">,
  current = appVersion,
): Release | null {
  const update = availableUpdate(settings, current);
  return update && (!settings.updateDismissed || isNewer(update.version, settings.updateDismissed)) ? update : null;
}

/** Production servers check daily while the setting is on; development servers and tests never do. */
export function dailyCheckRuns(): boolean {
  return process.env.NODE_ENV === "production";
}

/** The calendar day in UTC: "2026-10-18". */
const utcDay = (date: Date) => date.toISOString().slice(0, 10);

const globalForCheck = globalThis as unknown as { updateCheckDay?: string };

type DailyOptions = { now?: Date; runs?: boolean; fetchImpl?: typeof fetch };

/**
 * Checks for an update unless it has already today. Past the first page load
 * of the day, it returns without touching the database. The day is saved
 * before asking, so a check that fails isn't tried again until the next day.
 */
export async function checkIfNewDay({ now = new Date(), runs = dailyCheckRuns(), fetchImpl = fetch }: DailyOptions = {}): Promise<
  "checked" | "skipped"
> {
  if (!runs) return "skipped";
  const day = utcDay(now);
  // Set before anything async, so pages loading together don't check twice.
  if (globalForCheck.updateCheckDay === day) return "skipped";
  globalForCheck.updateCheckDay = day;

  const settings = await loadSettings();
  if (!settings.updateCheck || settings.updateCheckDay === day) return "skipped";
  await saveSettings({ updateCheckDay: day });
  await checkForUpdate(fetchImpl);
  return "checked";
}

/** Run by the signed-in layout after each page load (see after()). Never throws. */
export async function checkForUpdatesDaily(): Promise<void> {
  await checkIfNewDay().catch((error: unknown) => logServerError("update check", error));
}
