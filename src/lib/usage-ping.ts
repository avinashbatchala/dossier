import "server-only";

import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import type { SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { appVersion } from "@/lib/version";

// The usage ping: on each day someone signed in opens a page, the server
// sends this install's random ID and the app's version, once, so the project
// can count the installs in use and how often they're used. Nothing else is
// sent. It's opt-in (#172): nothing goes until the operator says yes, in the
// question shown after sign-in or in Settings → About, or with
// DOSSIER_TELEMETRY=on. DOSSIER_TELEMETRY wins while it's set. The receiving
// end runs on the project's own server and isn't published with the app.

export const USAGE_PING_HOST = "telemetry.dossier.aien.me";
export const USAGE_PING_URL = `https://${USAGE_PING_HOST}/ping`;

/** The UTC day this process last checked for, so later page loads that day skip the database. */
const globalForPing = globalThis as unknown as { usagePingDay?: string };

/**
 * The version of the question's text (UsagePingDialog). A stored answer to an
 * older version counts as no answer, so change it, and ask again, whenever
 * what the ping sends or who receives it changes.
 */
export const USAGE_PING_TEXT_VERSION = 1;

/** Logged once at startup while the ping is on. */
export const USAGE_PING_NOTICE =
  `Usage ping: on each day Dossier is used, it sends ${USAGE_PING_HOST} a random install ID and its version number, once, ` +
  "to count the installs in use. Nothing else is sent. Turn it off in Settings → About, or set DOSSIER_TELEMETRY=off.";

/** Logged once at startup while nobody has answered yet. */
export const USAGE_PING_QUESTION_NOTICE =
  "Usage ping: off until someone signs in and answers whether to send it, or DOSSIER_TELEMETRY is set to on or off.";

/** Whether the ping is wanted, and who said so: the environment, an answer in the app, or nobody yet. */
export type UsagePingChoice = { choice: "on" | "off"; source: "env" | "app" } | { choice: null; source: null };

/** DOSSIER_TELEMETRY while it's set, else the answer to the current question; null until there is one. */
export function usagePingChoice(
  settings: Pick<SettingsData, "usagePingChoice" | "usagePingChoiceText">,
  fromEnv: "on" | "off" | undefined = env.DOSSIER_TELEMETRY,
): UsagePingChoice {
  if (fromEnv) return { choice: fromEnv, source: "env" };
  if (settings.usagePingChoice && settings.usagePingChoiceText === USAGE_PING_TEXT_VERSION) {
    return { choice: settings.usagePingChoice, source: "app" };
  }
  return { choice: null, source: null };
}

/** Only production servers ever send it or ask; development servers and tests never do. */
const sendsFromHere = () => process.env.NODE_ENV === "production";

/** Whether this server sends the ping: in production, after a yes. */
export function usagePingEnabled(settings: Pick<SettingsData, "usagePingChoice" | "usagePingChoiceText">): boolean {
  return sendsFromHere() && usagePingChoice(settings).choice === "on";
}

/** Whether to ask after sign-in: in production, while nobody has answered and DOSSIER_TELEMETRY isn't set. */
export function askForUsagePing(settings: Pick<SettingsData, "usagePingChoice" | "usagePingChoiceText">): boolean {
  return sendsFromHere() && usagePingChoice(settings).choice === null;
}

/**
 * Saves an answer, with when it was given and to which question. A no
 * forgets the install's ID, so what was sent before and anything sent after
 * a later yes can't be linked.
 */
export async function saveUsagePingChoice(choice: "on" | "off", now = new Date()): Promise<void> {
  await saveSettings({
    usagePingChoice: choice,
    usagePingChoiceAt: now.toISOString(),
    usagePingChoiceText: USAGE_PING_TEXT_VERSION,
    ...(choice === "off" ? { usagePingId: null, usagePingDay: null } : {}),
  });
  // A yes can send today's ping on the next page; a no stops it from this one on.
  delete globalForPing.usagePingDay;
}

/**
 * At startup, records DOSSIER_TELEMETRY as the stored answer when it's set and
 * differs, so the answer in effect is on record; off forgets the ID too.
 */
export async function recordEnvChoice(fromEnv: "on" | "off" | undefined = env.DOSSIER_TELEMETRY, now = new Date()): Promise<void> {
  if (!fromEnv) return;
  const settings = await loadSettings();
  const recorded = settings.usagePingChoice === fromEnv && settings.usagePingChoiceText === USAGE_PING_TEXT_VERSION;
  if (!recorded || (fromEnv === "off" && settings.usagePingId)) await saveUsagePingChoice(fromEnv, now);
}

/** The startup log line: what the ping sends while it's on, how to answer while nobody has; nothing otherwise. */
export function usagePingNotice(settings: Pick<SettingsData, "usagePingChoice" | "usagePingChoiceText">): string | null {
  if (usagePingEnabled(settings)) return USAGE_PING_NOTICE;
  if (askForUsagePing(settings)) return USAGE_PING_QUESTION_NOTICE;
  return null;
}

/** The calendar day in UTC, as the receiver records it: "2026-10-16". */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type PingOptions = { now?: Date; production?: boolean; fetchImpl?: typeof fetch };

/**
 * Sends today's ping, if the operator said yes and it hasn't gone already.
 * Past the first page load of the day, it returns without touching the
 * database. The day is saved before sending, so a ping that fails isn't
 * tried again until the next day.
 */
export async function pingIfNewDay({ now = new Date(), production = sendsFromHere(), fetchImpl = fetch }: PingOptions = {}): Promise<"sent" | "failed" | "skipped"> {
  if (!production || env.DOSSIER_TELEMETRY === "off") return "skipped";
  const day = utcDay(now);
  // Set before anything async, so pages loading together don't send it twice.
  // An answer clears it (saveUsagePingChoice), so a yes sends on the next page.
  if (globalForPing.usagePingDay === day) return "skipped";
  globalForPing.usagePingDay = day;

  // After a restart, the database knows whether today's has gone.
  const settings = await loadSettings();
  if (usagePingChoice(settings).choice !== "on" || settings.usagePingDay === day) return "skipped";
  const id = settings.usagePingId ?? randomUUID();
  await saveSettings({ usagePingId: id, usagePingDay: day });
  return (await sendPing(id, fetchImpl)) ? "sent" : "failed";
}

/** One request with the ID and the version; false if it doesn't arrive. Never throws. */
export async function sendPing(id: string, fetchImpl: typeof fetch = fetch, url = env.DOSSIER_USAGE_PING_TEST_URL ?? USAGE_PING_URL): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, version: appVersion }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return response.ok;
  } catch {
    // Offline, blocked or slow: it tries again on the next day of use, without filling the logs.
    return false;
  }
}

/** Run by the signed-in layout after each page load (see after()). Never throws. */
export async function notePageLoad(): Promise<void> {
  await pingIfNewDay().catch((error: unknown) => logServerError("usage ping", error));
}
