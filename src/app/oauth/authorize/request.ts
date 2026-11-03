import "server-only";

import { addedRedirects, allowedRedirect, clientAllows, connectorSince, readClient } from "@/lib/connector/oauth";

/** An authorization request (RFC 6749 §4.1.1 with PKCE), as Claude or another MCP app sends it. */
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
 * page, never redirected to: only an app starts these, and a bad client or
 * redirect must never send the browser anywhere.
 */
export async function checkAuthorizeRequest(params: Record<string, string | string[] | undefined>): Promise<AuthorizeRequest | { error: string }> {
  if (!(await connectorSince())) return { error: "The MCP connector is off. Turn it on in Settings → MCP connector, then connect again from the app." };
  const client = await readClient(one(params.client_id));
  if (!client) return { error: "This sign-in link isn't valid any more. Remove Dossier in the app and add it again." };
  const redirectUri = one(params.redirect_uri);
  if (!allowedRedirect(redirectUri, await addedRedirects()) || !clientAllows(client, redirectUri)) {
    return { error: "This sign-in would send you to an address Dossier doesn't know, so it was stopped. Add the app's callback address in Settings → MCP connector first." };
  }
  if (one(params.response_type) !== "code") return { error: "The app asked for a kind of sign-in Dossier doesn't offer." };
  const codeChallenge = one(params.code_challenge);
  if (one(params.code_challenge_method) !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return { error: "The app's sign-in request is missing its PKCE challenge." };
  }
  return { clientId: one(params.client_id), clientName: client.name, redirectUri, codeChallenge, state: one(params.state), resource: one(params.resource) };
}
