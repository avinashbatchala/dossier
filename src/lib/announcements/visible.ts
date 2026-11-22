import { isNewer } from "@/lib/releases";
import type { SettingsData } from "@/lib/settings";
import { appVersion } from "@/lib/version";
import { webHref } from "@/lib/web-link";

import type { Announcement, Severity } from "./contract";

// Which of the backend's notices this install shows. All of it is decided
// here, so the request says nothing about the install.

/** Dismissed IDs kept; far more than will ever be live at once. */
const MAX_DISMISSED = 100;

const SEVERITY_ORDER: Record<Severity, number> = { security: 0, important: 1, info: 2 };

/** Whether a notice is for this version, and not past its expiry. Both version limits are inclusive. */
export function applies({ minVersion, maxVersion, expiresAt }: Announcement, now: Date, current: string): boolean {
  if (minVersion && isNewer(minVersion, current)) return false;
  if (maxVersion && isNewer(current, maxVersion)) return false;
  return !expiresAt || new Date(expiresAt) > now;
}

/**
 * The notice to show now: the most severe that applies and isn't dismissed,
 * then the newest. Its link can go anywhere on the web, and is gone if it's
 * anything else: it becomes an href, where `javascript:` would run here.
 */
export function currentAnnouncement(
  { announcementFeed, announcementsDismissed }: Pick<SettingsData, "announcementFeed" | "announcementsDismissed">,
  now = new Date(),
  current = appVersion,
): Announcement | null {
  const [first] = (announcementFeed?.items ?? [])
    .filter((notice) => !announcementsDismissed.includes(notice.id) && applies(notice, now, current))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (!first) return null;
  const url = first.link && webHref(first.link.url);
  return { ...first, link: first.link && url ? { label: first.link.label, url } : null };
}

/** The dismissed IDs with this one added, newest last, up to the limit. */
export function withDismissed(dismissed: readonly string[], id: string): string[] {
  return [...dismissed.filter((other) => other !== id), id].slice(-MAX_DISMISSED);
}
