import "server-only";

import { randomUUID } from "node:crypto";

import { EncryptJWT, jwtDecrypt } from "jose";
import { cookies } from "next/headers";

import { deriveKey } from "@/lib/keys";

import { isHttps, passwordFingerprint } from "./session";

// A browser that signed in here before keeps this cookie, and signing out
// doesn't remove it (#334). The limit on wrong passwords from everyone
// together doesn't stop such a browser, so someone guessing from many
// addresses can keep new browsers out for a while, but not the person's own.
// It holds a random id with a limit of its own, wherever the browser
// connects from. Like the session, it's encrypted with a key derived from
// DOSSIER_SECRET and carries the password's fingerprint, so changing the
// password makes every browser a new one again.

export const KNOWN_BROWSER_COOKIE = "dossier_browser";

/** A year, under the 400 days browsers keep a cookie at most. */
export const KNOWN_BROWSER_LIFETIME = 365 * 24 * 60 * 60;

type TokenOptions = {
  key: Uint8Array;
  /** passwordFingerprint() of the current DOSSIER_PASSWORD. */
  fingerprint: string;
  now?: Date;
};

function tokenOptions(): TokenOptions {
  return { key: deriveKey("known-browser"), fingerprint: passwordFingerprint() };
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** The cookie's encrypted token for the browser `id`. */
export async function encodeKnownBrowser(id: string, { key, fingerprint, now = new Date() }: TokenOptions): Promise<string> {
  return new EncryptJWT({ browser: id, pwd: fingerprint })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(seconds(now))
    .setExpirationTime(seconds(now) + KNOWN_BROWSER_LIFETIME)
    .encrypt(key);
}

/** The browser's id, or null when the token is missing, tampered with, expired, or from another password. */
export async function decodeKnownBrowser(
  token: string | undefined,
  { key, fingerprint, now = new Date() }: TokenOptions,
): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, key, {
      currentDate: now,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
      requiredClaims: ["iat", "exp"],
    });
    if (typeof payload.browser !== "string" || payload.pwd !== fingerprint) return null;
    return payload.browser;
  } catch {
    return null;
  }
}

/** The id of the browser making this request when it signed in here before, or null. */
export async function knownBrowser(): Promise<string | null> {
  return decodeKnownBrowser((await cookies()).get(KNOWN_BROWSER_COOKIE)?.value, tokenOptions());
}

/** After the right password: the browser counts as one that signed in before, with a new id. */
export async function rememberBrowser(): Promise<void> {
  const token = await encodeKnownBrowser(randomUUID(), tokenOptions());
  (await cookies()).set(KNOWN_BROWSER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isHttps(),
    maxAge: KNOWN_BROWSER_LIFETIME,
  });
}
