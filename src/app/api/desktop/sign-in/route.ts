import { startSession } from "@/lib/auth/session";
import { DESKTOP_TOKEN_HEADER, isDesktopToken } from "@/lib/desktop";

/**
 * How the desktop app signs itself in, on a server it started: with the token
 * it made for this launch, in a header, so it's never in a URL or a log. Anywhere
 * else this address doesn't exist.
 */
export async function GET(request: Request) {
  if (!isDesktopToken(request.headers.get(DESKTOP_TOKEN_HEADER))) return new Response(null, { status: 404 });
  await startSession({ persistent: true });
  return new Response(null, { status: 303, headers: { location: "/" } });
}
