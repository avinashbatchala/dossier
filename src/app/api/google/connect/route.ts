import { NextResponse } from "next/server";

import { loadGoogleAccount } from "@/lib/google/account";
import { authorizeUrl, googleClient, redirectUri, SCOPES, signState, type ScopeGroup } from "@/lib/google/oauth";
import { publicOrigin } from "@/lib/google/origin";
import { route } from "@/lib/route";

const GROUPS: readonly ScopeGroup[] = ["send", "read", "calendar"];

/**
 * Starts connecting Google (E15-1): `?scopes=send,read,calendar` picks the
 * features, added to what was granted before. Sends the browser to Google's
 * consent page, which comes back to /api/google/callback.
 */
export const GET = route(async (request) => {
  const client = await googleClient();
  const settings = new URL("/settings?section=google", publicOrigin(request));
  if (!client) {
    settings.searchParams.set("google", "not-configured");
    return NextResponse.redirect(settings);
  }
  const asked = (request.nextUrl.searchParams.get("scopes") ?? GROUPS.join(","))
    .split(",")
    .filter((group): group is ScopeGroup => (GROUPS as readonly string[]).includes(group));
  const account = await loadGoogleAccount();
  const scopes = [...SCOPES.identity, ...(account?.scopes.split(/\s+/) ?? []), ...asked.flatMap((group) => SCOPES[group])].filter(Boolean);
  const state = await signState("/settings?section=google");
  return NextResponse.redirect(authorizeUrl({ clientId: client.id, redirect: redirectUri(publicOrigin(request)), state, scopes }));
});
