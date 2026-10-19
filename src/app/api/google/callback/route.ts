import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { saveGoogleAccount } from "@/lib/google/account";
import { GoogleError } from "@/lib/google/errors";
import { emailFromIdToken, exchangeCode, redirectUri, verifyState } from "@/lib/google/oauth";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/**
 * Where Google sends the browser back after consent (E15-1). It comes from
 * Google's site, so route()'s same-origin check can't apply: the signed
 * state proves Dossier started it, and the session that it's the user.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  const back = (outcome: string) => {
    const url = new URL("/settings?section=google", origin);
    url.searchParams.set("google", outcome);
    const response = NextResponse.redirect(url);
    response.headers.set("cache-control", "private, no-store");
    return response;
  };

  if (!(await getSession())) return NextResponse.redirect(new URL("/login", origin));
  const params = request.nextUrl.searchParams;
  if (!(await verifyState(params.get("state")))) return back("expired");
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "failed");
  const code = params.get("code");
  if (!code) return back("failed");

  try {
    const tokens = await exchangeCode(code, redirectUri(origin));
    const email = emailFromIdToken(tokens.id_token);
    if (!email) return back("failed");
    await saveGoogleAccount({ email, refreshToken: tokens.refresh_token, scopes: tokens.scope });
    return back("connected");
  } catch (error) {
    if (!(error instanceof GoogleError)) logServerError("google callback", error);
    return back(error instanceof GoogleError && error.problem === "rejected" ? "rejected" : "failed");
  }
}
