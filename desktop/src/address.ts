// The address of the user's own server, for "On my server".

export type Address = { origin: string; encrypted: boolean };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * What was typed, as the server's origin; null if it can't be an address.
 * Without a scheme it means https. A path is dropped, since Dossier is always
 * at the root of its address.
 */
export function parseAddress(input: string): Address | null {
  const value = input.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
  // Over plain HTTP the password travels unencrypted, except on this computer itself.
  return { origin: url.origin, encrypted: url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname) };
}

/** Whether an answer from /api/health is Dossier's: its status, version and database. */
export function isDossierHealth(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { status, version, db } = body as Record<string, unknown>;
  return (status === "ok" || status === "unavailable") && typeof version === "string" && (db === "ok" || db === "unreachable");
}

export type ServerCheck = "ok" | "unreachable" | "certificate" | "not-dossier";

const TIMEOUT_MS = 10_000;

/** Asks the address for Dossier's health check. A server whose database is down still counts: it's Dossier, and it says so itself. */
export async function checkServer(origin: string, fetchImpl: typeof fetch): Promise<ServerCheck> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return /ERR_CERT|ERR_SSL/i.test(String(error)) ? "certificate" : "unreachable";
  }
  try {
    return isDossierHealth(await response.json()) ? "ok" : "not-dossier";
  } catch {
    return "not-dossier";
  }
}
