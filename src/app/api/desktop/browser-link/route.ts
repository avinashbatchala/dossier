import { z } from "zod";

import { DESKTOP_TOKEN_HEADER, isDesktopToken } from "@/lib/desktop";
import { mintBrowserCode } from "@/lib/desktop-browser";

const body = z.object({ next: z.string().max(4000).optional() });

/**
 * The desktop app asking for a one-time link that signs the system browser in
 * (#365, #327), with its launch token in a header. Anywhere else, and without
 * the token, this address doesn't exist.
 */
export async function POST(request: Request) {
  if (!isDesktopToken(request.headers.get(DESKTOP_TOKEN_HEADER))) return new Response(null, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  const code = mintBrowserCode(parsed.success ? parsed.data.next : undefined);
  return Response.json({ path: `/api/desktop/browser-sign-in?code=${encodeURIComponent(code)}` }, { headers: { "cache-control": "no-store" } });
}
