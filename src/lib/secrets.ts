import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { deriveKey, type KeyPurpose } from "@/lib/keys";

// Secrets kept in the database, such as API keys (SET-1, PRD §11): AES-256-GCM
// under a key derived from DOSSIER_SECRET for that kind of secret only, a
// random IV per encryption, and a version prefix so the format can change
// later. Stored as "v1.<iv>.<ciphertext + tag>", both base64url.

/** What a secret is: its own derived key, and associated data that binds the ciphertext to it. */
export type SecretKind = { purpose: KeyPurpose; associatedData: string };

/** The AI provider's API key (E6-2). */
export const AI_API_KEY: SecretKind = { purpose: "api-key-encryption", associatedData: "dossier api key v1" };
/** A job source's API key (E14-4). */
export const JOB_SOURCE_KEY: SecretKind = { purpose: "job-source-key-encryption", associatedData: "dossier job source key v1" };
/** The Google account's refresh token (E15-1). */
export const GOOGLE_TOKEN: SecretKind = { purpose: "google-token-encryption", associatedData: "dossier google token v1" };
/** The Google OAuth client's secret, entered in Settings → Google. */
export const GOOGLE_CLIENT_SECRET: SecretKind = { purpose: "google-client-secret-encryption", associatedData: "dossier google client secret v1" };

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Thrown when a stored secret can't be decrypted. Its message never contains key material. */
export class SecretUnreadable extends Error {
  override name = "SecretUnreadable";
  constructor() {
    super("A saved secret can't be read.");
  }
}

export function encryptSecret(kind: SecretKind, value: string, secret?: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(kind.purpose, secret), iv);
  cipher.setAAD(Buffer.from(kind.associatedData));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, iv.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(kind: SecretKind, stored: string, secret?: string): string {
  const [version, iv, encrypted, ...rest] = stored.split(".");
  if (version !== VERSION || !iv || !encrypted || rest.length > 0) throw new SecretUnreadable();
  try {
    const data = Buffer.from(encrypted, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(kind.purpose, secret), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(kind.associatedData));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    // Wrong secret, the wrong kind, tampering or a damaged value: GCM refuses them all alike.
    throw new SecretUnreadable();
  }
}

/** What a settings screen may know about a saved secret: never the secret itself. */
export type SecretState = "none" | "set" | "unreadable";

export function secretState(kind: SecretKind, stored: string | null, secret?: string): SecretState {
  if (!stored) return "none";
  try {
    decryptSecret(kind, stored, secret);
    return "set";
  } catch {
    return "unreadable";
  }
}

/**
 * How a settings save changes a secret: an empty field keeps the saved one
 * (the browser never gets it back to resend), a new value replaces it, and
 * only an explicit clear removes it.
 */
export type SecretChange = { action: "keep" } | { action: "set"; value: string } | { action: "clear" };

/** The stored value after `change`. */
export function applySecretChange(kind: SecretKind, stored: string | null, change: SecretChange, secret?: string): string | null {
  switch (change.action) {
    case "keep":
      return stored;
    case "clear":
      return null;
    case "set": {
      const value = change.value.trim();
      return value ? encryptSecret(kind, value, secret) : stored;
    }
  }
}
