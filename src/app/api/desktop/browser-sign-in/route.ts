import { startSession } from "@/lib/auth/session";
import { isDesktopApp } from "@/lib/desktop";
import { takeBrowserCode } from "@/lib/desktop-browser";

/**
 * The one-time link the desktop app opens in the system browser (#365, #327):
 * it signs the browser in until it's closed and goes on to where the app
 * said. A used, unknown or expired link goes to the sign-in page, which says
 * how to get a new one. Only on a server the desktop app started.
 */
export async function GET(request: Request) {
  if (!isDesktopApp()) return new Response(null, { status: 404 });
  const next = takeBrowserCode(new URL(request.url).searchParams.get("code"));
  if (next === null) return new Response(null, { status: 303, headers: { location: "/login?link=expired", "cache-control": "no-store" } });
  await startSession({ persistent: false });
  return new Response(null, { status: 303, headers: { location: next, "cache-control": "no-store" } });
}
