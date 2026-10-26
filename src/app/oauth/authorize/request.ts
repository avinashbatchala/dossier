import "server-only";

import { allowedRedirect, clientAllows, connectorSince, readClient } from "@/lib/connector/oauth";

/** An authorization request (RFC 6749 §4.1.1 with PKCE), as Claude sends it. */
export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  resource: string;
};

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Checks an authorization request (#221). Whatever is wrong is shown on the
 * page, never redirected to: only Claude starts these, and a bad client or
 * redirect must never send the browser anywhere.
 */
export async function checkAuthorizeRequest(params: Record<string, string | string[] | undefined>): Promise<AuthorizeRequest | { error: string }> {
  if (!(await connectorSince())) return { error: "The Claude connector is off. Turn it on in Settings → Claude connector, then connect again from Claude." };
  const client = await readClient(one(params.client_id));
  if (!client) return { error: "Claude's sign-in link isn't valid any more. Remove the connector in Claude and add it again." };
  const redirectUri = one(params.redirect_uri);
  if (!allowedRedirect(redirectUri) || !clientAllows(client, redirectUri)) return { error: "This sign-in would send you somewhere other than Claude, so it was stopped." };
  if (one(params.response_type) !== "code") return { error: "Claude asked for a kind of sign-in Dossier doesn't offer." };
  const codeChallenge = one(params.code_challenge);
  if (one(params.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return { error: "Claude's sign-in request is missing its PKCE challenge." };
  }
  return { clientId: one(params.client_id), clientName: client.name, redirectUri, codeChallenge, state: one(params.state), resource: one(params.resource) };
}
