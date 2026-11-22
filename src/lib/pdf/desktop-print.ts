import "server-only";

import { DESKTOP_TOKEN_HEADER } from "@/lib/desktop";
import { env } from "@/lib/env";

import { signPrintToken } from "./print-token";

const TIMEOUT_MS = 60_000;

/**
 * Prints a page through the desktop app, on a server it started: Electron already
 * holds a Chromium, so no second browser ships. Throws when it can't, as the
 * image's renderer does, so a failure is never a wrong PDF.
 */
export async function printWithDesktopApp(url: string, page: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", [DESKTOP_TOKEN_HEADER]: env.DOSSIER_DESKTOP_TOKEN ?? "" },
    body: JSON.stringify({ page, printToken: await signPrintToken(page) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`The desktop app couldn't print ${page}: ${await response.text()}`);
  return new Uint8Array(await response.arrayBuffer());
}
