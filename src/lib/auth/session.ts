import "server-only";

import { createHmac } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { verifyPassword } from "@/lib/auth/password-hash";
import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";

// Sessions are stateless: the cookie holds an encrypted token (JWE,
// A256GCM with a key derived from DOSSIER_SECRET), so nothing is stored on
// the server, and tampering or a different secret makes it invalid. Each
// token also carries a fingerprint of DOSSIER_PASSWORD (the password's
// hash), so changing the password and restarting signs everyone out (AUTH-6).

export const SESSION_COOKIE = "dossier_session";

const HOUR = 60 * 60;
/** How long a sign-in lasts: 24 hours for a browser session (decision in #27), 30 days with "Keep me signed in". */
export const SESSION_LIFETIME = { browser: 24 * HOUR, persistent: 30 * 24 * HOUR } as const;

/** A signed-in session. */
export type Session = {
  /** Signed in with "Keep me signed in". */
  persistent: boolean;
  issuedAt: Date;
  expiresAt: Date;
};

type TokenOptions = {
  key: Uint8Array;
  /** passwordFingerprint() of the current DOSSIER_PASSWORD. */
  fingerprint: string;
  now?: Date;
};

/**
 * A short HMAC of DOSSIER_PASSWORD, keyed from DOSSIER_SECRET. It identifies
 * the password a session was created with, without revealing it.
 */
export function passwordFingerprint(
  password = env.DOSSIER_PASSWORD,
  key = deriveKey("password-fingerprint"),
): string {
  return createHmac("sha256", key).update(password, "utf8").digest("base64url").slice(0, 16);
}

/** The key and fingerprint that sessions are created and checked with. */
export function sessionTokenOptions(): TokenOptions {
  return { key: deriveKey("session"), fingerprint: passwordFingerprint() };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Creates the encrypted session token. */
export async function encodeSession(
  { persistent }: { persistent: boolean },
  { key, fingerprint, now = new Date() }: TokenOptions,
): Promise<string> {
  const issuedAt = seconds(now);
  return new EncryptJWT({ persistent, pwd: fingerprint })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_LIFETIME[persistent ? "persistent" : "browser"])
    .encrypt(key);
}

/**
 * Reads a session token; null when it's missing, tampered with, expired, made
 * with another key, or made while a different password was set.
 */
export async function decodeSession(
  token: string | undefined,
  { key, fingerprint, now = new Date() }: TokenOptions,
): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, {
      currentDate: now,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"],
    });
    if (typeof payload.persistent !== "boolean" || payload.pwd !== fingerprint) return null;
    return {
      persistent: payload.persistent,
      issuedAt: new Date(payload.iat! * 1000),
      expiresAt: new Date(payload.exp! * 1000),
    };
  } catch {
    return null;
  }
}

/** Whether `candidate` is the password that DOSSIER_PASSWORD is a hash of. */
export function passwordMatches(candidate: string, hash = env.DOSSIER_PASSWORD): Promise<boolean> {
  return verifyPassword(candidate, hash);
}

/** Whether the browser reached us over HTTPS, as the reverse proxy reports it. */
export async function isHttps(): Promise<boolean> {
  const proto = (await headers()).get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim() === "https";
}

/** Signs the user in: sets the session cookie. Call from a Server Action or route handler. */
export async function startSession({ persistent }: { persistent: boolean }): Promise<void> {
  const token = await encodeSession({ persistent }, sessionTokenOptions());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isHttps(),
    // Without maxAge it's a browser-session cookie; the token expires anyway.
    ...(persistent ? { maxAge: SESSION_LIFETIME.persistent } : {}),
  });
}

/** The current session, or null when the request isn't signed in. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return decodeSession(token, sessionTokenOptions());
});

/**
 * The current session, for pages and layouts: sends the visitor to /login
 * when there is none. Proxy (src/proxy.ts) usually redirects first; this is
 * the check that counts, next to the data.
 */
export async function verifySession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Signs the user out: deletes the session cookie (AUTH-7). */
export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
