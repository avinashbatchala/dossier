import "server-only";

import { headers } from "next/headers";

import { formatShortDate } from "@/lib/dates";
import { googleConnection } from "@/lib/google/account";
import { loadGoogleClientConfig } from "@/lib/google/oauth";

// What Settings and the setup guide (E21) both show.

/** The connection as the Google section shows it: never a token. */
export async function googleView() {
  const connection = await googleConnection();
  if (connection.status !== "connected") return connection;
  const { lastSyncAt, ...rest } = connection;
  return { ...rest, lastSync: whenRan(lastSyncAt) };
}

/** The OAuth client as the Google section shows it: the ID, never the secret. */
export async function googleClientView() {
  const { id, idState, secretState } = await loadGoogleClientConfig();
  return { id, idState, secretState };
}

/** The address this page was reached at, for the redirect URI to register. */
export async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim() || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** "today at 03:00", "yesterday at 03:00" or "on 25 Sep at 03:00", in the server's time zone. */
export function whenRan(date: Date | null, now = new Date()): string | null {
  if (!date) return null;
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${formatShortDate(date, now)} at ${time}`;
}
