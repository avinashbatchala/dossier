import { route } from "@/lib/route";

/**
 * Whether this browser is signed in: route() answers 401 when it isn't. The
 * sign-in page in the browser asks it, on this computer, while it waits for
 * the desktop app to sign the browser in (#365).
 */
export const GET = route(async () => Response.json({ signedIn: true }, { headers: { "cache-control": "no-store" } }));
