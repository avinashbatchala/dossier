import "server-only";

import { cookies } from "next/headers";

import { TIME_ZONE_COOKIE } from "@/lib/greeting";
import { loadSettings, saveSettings } from "@/lib/settings-data";

/** Whether `Intl` takes `zone` as a time zone. */
function isTimeZone(zone: string | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The browser's time zone as it last told the server (the dashboard's
 * greeting keeps it in a cookie), for showing times the user picked, such as
 * an interview (E9-9). Undefined when unknown: then the server's own is used.
 */
export async function userTimeZone(): Promise<string | undefined> {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  if (!value) return undefined;
  try {
    const zone = decodeURIComponent(value);
    return isTimeZone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The server's own time zone, or UTC when it has none `Intl` takes: an
 * empty TZ makes Node report "Etc/Unknown", and some values none at all
 * (#258).
 */
export function serverTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone as string | undefined;
  return isTimeZone(zone) ? zone : "UTC";
}

/**
 * The user's time zone where there may be no request, as in the inbox
 * check or a job: this request's browser zone when there is one, else the
 * one the browser last told the server, else the server's own.
 */
export async function lastKnownTimeZone(): Promise<string> {
  let zone: string | undefined;
  try {
    zone = await userTimeZone();
  } catch {
    // No request: cookies() can't be read here.
  }
  return zone ?? (await loadSettings()).browserTimeZone ?? serverTimeZone();
}

/** Keeps the browser's zone for work done without a request; called after a page with the zone its request had. */
export async function rememberBrowserTimeZone(zone: string | undefined): Promise<void> {
  if (!zone) return;
  const { browserTimeZone } = await loadSettings();
  if (browserTimeZone !== zone) await saveSettings({ browserTimeZone: zone });
}
