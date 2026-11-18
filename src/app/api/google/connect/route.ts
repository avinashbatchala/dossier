import { NextResponse } from "next/server";

import { loadGoogleAccount } from "@/lib/google/account";
import { authorizeUrl, CALLBACK_PATH, googleClient, pkcePair, PKCE_COOKIE, redirectUri, SCOPES, signState, type ScopeGroup } from "@/lib/google/oauth";
import { publicOrigin } from "@/lib/google/origin";
import { route } from "@/lib/route";

const GROUPS: readonly ScopeGroup[] = ["send", "read", "calendar"];

/** Where to come back to: Settings → Google, or the setup guide (E21-5) when it asks. */
function returnTo(request: Request): string {
  const asked = new URL(request.url).searchParams.get("return");
  return asked && /^\/welcome(\?|$)/.test(asked) ? asked : "/settings?section=google";
}

/**
 * Starts connecting Google (E15-1): `?scopes=send,read,calendar` picks the
 * features, added to what was granted before; `?return=` the setup guide, to
 * come back to it. Sends the browser to Google's consent page, which comes
 * back to /api/google/callback.
 */
export const GET = route(async (request) => {
  const client = await googleClient();
  const back = returnTo(request);
  if (!client) {
    const url = new URL(back, publicOrigin(request));
    url.searchParams.set("google", "not-configured");
    return NextResponse.redirect(url);
  }
  const asked = (request.nextUrl.searchParams.get("scopes") ?? GROUPS.join(","))
    .split(",")
    .filter((group): group is ScopeGroup => (GROUPS as readonly string[]).includes(group));
  const account = await loadGoogleAccount();
  const scopes = [...SCOPES.identity, ...(account?.scopes.split(/\s+/) ?? []), ...asked.flatMap((group) => SCOPES[group])].filter(Boolean);
  const state = await signState(back);
  const origin = publicOrigin(request);
  const { verifier, challenge } = pkcePair();
  const response = NextResponse.redirect(authorizeUrl({ clientId: client.id, redirect: redirectUri(origin), state, scopes, challenge }));
  // PKCE (#358): only this browser, coming back to the callback within ten minutes, can trade the code.
  response.cookies.set(PKCE_COOKIE, verifier, { httpOnly: true, sameSite: "lax", path: CALLBACK_PATH, maxAge: 600, secure: origin.startsWith("https:") });
  return response;
});
