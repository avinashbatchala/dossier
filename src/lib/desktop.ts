import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "@/lib/env";

// When Dossier runs inside the desktop app, on the user's own computer. There's
// no password then: the app starts this server with a token made for that launch
// and signs itself in with it. Everything else about signing in stays as it is,
// so other programs and websites reaching the port still land on the sign-in
// page, where no password can open it.

export const DESKTOP_TOKEN_HEADER = "x-dossier-desktop-token";

/** Whether this server was started by the desktop app. */
export function isDesktopApp(): boolean {
  return env.DOSSIER_DESKTOP_TOKEN !== undefined;
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Whether a request carries this launch's token. Never true on a server the desktop app didn't start. */
export function isDesktopToken(given: string | null, expected = env.DOSSIER_DESKTOP_TOKEN): boolean {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(given), digest(expected));
}
