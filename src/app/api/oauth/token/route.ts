import { connectorSince, exchangeCode, OAuthError, refresh } from "@/lib/connector/oauth";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

const fail = (error: OAuthError["code"], description: string) => Response.json({ error, error_description: description }, { status: 400, headers: NO_STORE });

/** The token endpoint (RFC 6749 §3.2, #221): codes and refresh tokens for access tokens. Form-encoded, as Claude sends it. */
export async function POST(request: Request) {
  if (!(await connectorSince())) return new Response(null, { status: 404 });
  const form = (request.headers.get("content-type") ?? "").includes("application/json")
    ? new URLSearchParams(Object.entries(((await request.json().catch(() => ({}))) ?? {}) as Record<string, string>))
    : new URLSearchParams(await request.text());
  const field = (name: string) => form.get(name) ?? "";
  try {
    const grant = field("grant_type");
    const tokens =
      grant === "authorization_code"
        ? await exchangeCode({ code: field("code"), clientId: field("client_id"), redirectUri: field("redirect_uri"), verifier: field("code_verifier") })
        : grant === "refresh_token"
          ? await refresh({ refreshToken: field("refresh_token"), clientId: field("client_id") })
          : null;
    if (!tokens) return fail("unsupported_grant_type", "Use authorization_code or refresh_token.");
    return Response.json(tokens, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.code, error.message);
    throw error;
  }
}
