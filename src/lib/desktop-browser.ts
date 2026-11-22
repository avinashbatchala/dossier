import "server-only";

import { randomBytes } from "node:crypto";

import { safeNextPath } from "@/lib/auth/next-path";

// Signing the system browser in, on a server the desktop app started (#365,
// #327). Some sign-ins run in the browser: Google refuses one inside the app,
// and an MCP app opens its approval page there. The browser has no session,
// and there's no password, so the app asks for a one-time link and opens it:
// the link signs the browser in for its session and goes on to `next`. Only
// the app can ask, with its launch token; a link works once, for a minute.

const LIFETIME_MS = 60_000;

// On globalThis, so the dev server's hot reloads keep them.
const globalForLinks = globalThis as unknown as { desktopBrowserLinks?: Map<string, { next: string; expires: number }> };
const links = (globalForLinks.desktopBrowserLinks ??= new Map());

/** A one-time code for the browser, going on to `next` (a path on this server). */
export function mintBrowserCode(next: string | null | undefined, now = Date.now()): string {
  for (const [code, link] of links) if (link.expires <= now) links.delete(code);
  const code = randomBytes(32).toString("base64url");
  links.set(code, { next: safeNextPath(next), expires: now + LIFETIME_MS });
  return code;
}

/** Where a code goes on to, using it up; null for one that's unknown, used or expired. */
export function takeBrowserCode(code: string | null, now = Date.now()): string | null {
  if (!code) return null;
  const link = links.get(code);
  links.delete(code);
  return link && link.expires > now ? link.next : null;
}
