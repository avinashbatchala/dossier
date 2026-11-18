import "server-only";

import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret, GOOGLE_TOKEN, SecretUnreadable } from "@/lib/secrets";

import { GoogleError, isPassing } from "./errors";
import { googleClient, hasScopes, refreshAccessToken, revokeToken, type ScopeGroup } from "./oauth";

// The connected Google account (E15-1) and authorised calls to Google's APIs.
// Access tokens last an hour and are kept in memory only; the refresh token
// is stored encrypted.

const ACCOUNT_ID = "google";

/** What the settings screen may know about the connection: never a token. */
export type GoogleConnection =
  | { status: "not-configured" }
  | { status: "disconnected" }
  | {
      status: "connected";
      email: string;
      canSend: boolean;
      canRead: boolean;
      canUseCalendar: boolean;
      lastSyncAt: Date | null;
      syncProblem: string | null;
      /** Why the saved access can't be used, so nothing is tried until the user connects again (#136); null when it can. */
      signInProblem: string | null;
    };

/** Stored in place of the refresh token once Google refuses it, so nothing asks Google again until a new sign-in. */
const REFUSED = "";
const SIGN_IN_AGAIN = "Google no longer accepts Dossier's access. Connect your Google account again.";
const UNREADABLE = "The saved Google access can't be read, probably since DOSSIER_SECRET changed. Connect your Google account again.";

/**
 * Why the saved refresh token can't be used: Google refused it, or it can't
 * be decrypted. An unreadable one is kept, since putting the old
 * DOSSIER_SECRET back makes it work again.
 */
function signInProblem(refreshTokenEnc: string): string | null {
  if (refreshTokenEnc === REFUSED) return SIGN_IN_AGAIN;
  try {
    decryptSecret(GOOGLE_TOKEN, refreshTokenEnc);
    return null;
  } catch {
    return UNREADABLE;
  }
}

export async function loadGoogleAccount() {
  return prisma.googleAccount.findUnique({ where: { id: ACCOUNT_ID } });
}

export async function googleConnection(): Promise<GoogleConnection> {
  if (!(await googleClient())) return { status: "not-configured" };
  const account = await loadGoogleAccount();
  if (!account) return { status: "disconnected" };
  return {
    status: "connected",
    email: account.email,
    canSend: hasScopes(account.scopes, "send"),
    canRead: hasScopes(account.scopes, "read"),
    canUseCalendar: hasScopes(account.scopes, "calendar"),
    lastSyncAt: account.lastSyncAt,
    syncProblem: account.syncProblem,
    signInProblem: signInProblem(account.refreshTokenEnc),
  };
}

/**
 * Saves the account after a sign-in. Google only sends a refresh token on
 * first consent; adding scopes later keeps the stored one.
 */
export async function saveGoogleAccount({ email, refreshToken, scopes }: { email: string; refreshToken: string | undefined; scopes: string }) {
  const existing = await loadGoogleAccount();
  const refreshTokenEnc = refreshToken ? encryptSecret(GOOGLE_TOKEN, refreshToken) : existing?.refreshTokenEnc;
  if (!refreshTokenEnc) throw new GoogleError("rejected", "Google didn't give Dossier lasting access. Remove Dossier at myaccount.google.com/permissions and connect again.");
  // Another account replaces the old one, and its sync starts afresh.
  const sameAccount = existing?.email.toLowerCase() === email.toLowerCase();
  const merged = sameAccount ? [...new Set([...existing!.scopes.split(/\s+/), ...scopes.split(/\s+/)])].filter(Boolean).join(" ") : scopes;
  await prisma.googleAccount.upsert({
    where: { id: ACCOUNT_ID },
    create: { id: ACCOUNT_ID, email, refreshTokenEnc, scopes },
    update: {
      email,
      refreshTokenEnc,
      scopes: merged,
      // A new token after Google refused the old one: its "connect again" is done.
      ...(refreshToken ? { syncProblem: null } : {}),
      ...(sameAccount ? {} : { historyId: null, lastSyncAt: null, syncProblem: null }),
    },
  });
  tokens.delete(ACCOUNT_ID);
}

/** Disconnects: revokes the grant at Google and forgets the account. Mail already fetched stays. */
export async function disconnectGoogle(): Promise<void> {
  const account = await loadGoogleAccount();
  if (!account) return;
  try {
    await revokeToken(decryptSecret(GOOGLE_TOKEN, account.refreshTokenEnc));
  } catch (error) {
    if (!(error instanceof SecretUnreadable)) throw error;
  }
  await prisma.googleAccount.deleteMany({ where: { id: ACCOUNT_ID } });
  tokens.delete(ACCOUNT_ID);
}

// On globalThis, so the dev server's hot reloads keep them.
const globalForTokens = globalThis as unknown as { googleTokens?: Map<string, { token: string; expires: number }> };
const tokens = (globalForTokens.googleTokens ??= new Map());

/** A valid access token for the connected account, refreshed when it's about to expire. */
async function accessToken(group: ScopeGroup, signal?: AbortSignal): Promise<string> {
  const account = await loadGoogleAccount();
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  if (!hasScopes(account.scopes, group)) {
    throw new GoogleError("scope", "Dossier doesn't have that permission yet. Allow it in Settings → Google.");
  }
  if (account.refreshTokenEnc === REFUSED) throw new GoogleError("revoked", SIGN_IN_AGAIN);
  const cached = tokens.get(ACCOUNT_ID);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  let refreshToken: string;
  try {
    refreshToken = decryptSecret(GOOGLE_TOKEN, account.refreshTokenEnc);
  } catch {
    throw new GoogleError("revoked", UNREADABLE);
  }
  try {
    const answer = await refreshAccessToken(refreshToken, signal);
    tokens.set(ACCOUNT_ID, { token: answer.access_token, expires: Date.now() + answer.expires_in * 1000 });
    return answer.access_token;
  } catch (error) {
    throw error instanceof GoogleError && error.problem === "revoked" ? await refused(error) : error;
  }
}

/**
 * Google won't take the saved access again (revoked, expired, or a changed
 * password): it's dropped and the reason kept, so the scheduled checks stop
 * until the user connects again (#136).
 */
async function refused(error: GoogleError): Promise<GoogleError> {
  tokens.delete(ACCOUNT_ID);
  await prisma.googleAccount.updateMany({ where: { id: ACCOUNT_ID }, data: { refreshTokenEnc: REFUSED, syncProblem: error.message } });
  return error;
}

const MAX_BYTES = 30 * 1024 * 1024;
const SLOW_DOWN = "Google asks Dossier to slow down. Try again in a few minutes.";
/** Before the second, third and fourth try, when the error passes (public issue 68). */
const RETRY_DELAYS_MS = [1000, 3000, 9000];

/** Google's reason for refusing ("rateLimitExceeded"), from the body of its error, or "" when it gives none. */
async function refusalReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    return body.error?.errors?.[0]?.reason ?? body.error?.status ?? "";
  } catch {
    return "";
  }
}

/** The Retry-After header, in milliseconds, at most a minute; undefined without one. */
function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  return response.headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 60) * 1000 : undefined;
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Calls a Google API with the account's token and returns its JSON. Errors
 * become GoogleErrors; tokens never reach a message or the log. With `retry`,
 * for the inbox check, which nobody waits for: when Google asks for a pause
 * or has a problem of its own, it's asked again a few times, after a while.
 * Gmail refuses a share of a long run of requests that way (public issue 68).
 */
export async function googleFetch<T = unknown>(
  group: ScopeGroup,
  url: string | URL,
  options: { method?: string; body?: unknown; signal?: AbortSignal; retry?: boolean } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await googleFetchOnce<T>(group, url, options);
    } catch (error) {
      if (!options.retry || !isPassing(error) || attempt >= RETRY_DELAYS_MS.length || options.signal?.aborted) throw error;
      await pause((error as GoogleError).retryAfterMs ?? RETRY_DELAYS_MS[attempt], options.signal);
    }
  }
}

async function googleFetchOnce<T>(
  group: ScopeGroup,
  url: string | URL,
  { method = "GET", body, signal }: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const token = await accessToken(group, signal);
  const timeout = AbortSignal.timeout(30_000);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    });
  } catch {
    throw new GoogleError("unavailable", "Couldn't reach Google. Try again in a moment.");
  }
  const path = new URL(url).pathname;
  if (response.status === 401) {
    tokens.delete(ACCOUNT_ID);
    throw new GoogleError("revoked", "Google no longer accepts Dossier's access. Connect your Google account again.", `${path}: 401`);
  }
  if (response.status === 403) {
    // Gmail says 403 for its per-user rate limit too, not only for a missing permission: the reason tells them apart.
    const reason = await refusalReason(response);
    if (/rateLimit|quota|dailyLimit/i.test(reason)) throw new GoogleError("quota", SLOW_DOWN, `${path}: 403 ${reason}`, 403, retryAfterMs(response));
    throw new GoogleError("scope", "Google refused that. Check the permissions in Settings → Google.", `${path}: 403${reason ? ` ${reason}` : ""}`, 403);
  }
  if (response.status === 429) throw new GoogleError("quota", SLOW_DOWN, `${path}: 429`, 429, retryAfterMs(response));
  if (response.status === 404 || response.status === 410) {
    throw new GoogleError("unavailable", "Google couldn't find that. It may have been deleted.", `${path}: ${response.status}`, response.status);
  }
  if (!response.ok) throw new GoogleError("unavailable", "Google had a problem with that. Try again in a moment.", `${path}: HTTP ${response.status}`, response.status);
  if (response.status === 204) return undefined as T;
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new GoogleError("unavailable", "Google's answer was too big.", `${path}: ${length} bytes`);
  return (await response.json()) as T;
}
