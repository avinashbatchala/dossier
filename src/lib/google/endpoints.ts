import { env } from "@/lib/env";

// Google's addresses. The end-to-end tests send them all to their fake Google
// instead (DOSSIER_GOOGLE_TEST_BASE_URL, answered by e2e/fake-google.mts), as
// <url>/<host>, so the real request and response handling runs end to end.

const HOSTS = {
  accounts: "https://accounts.google.com",
  oauth2: "https://oauth2.googleapis.com",
  gmail: "https://gmail.googleapis.com",
  www: "https://www.googleapis.com",
} as const;

/** `path` on one of Google's hosts, e.g. googleUrl("oauth2", "/token"). Read on each call, as env is. */
export function googleUrl(host: keyof typeof HOSTS, path: string, base = env.DOSSIER_GOOGLE_TEST_BASE_URL): string {
  return `${base ? `${base.replace(/\/+$/, "")}/${host}` : HOSTS[host]}${path}`;
}
