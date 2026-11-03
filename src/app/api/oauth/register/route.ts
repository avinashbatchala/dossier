import { z } from "zod";

import { addedRedirects, allowedRedirect, connectorSince, isClaudeRedirect, registerClient } from "@/lib/connector/oauth";

const registration = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().max(200).optional(),
});

/**
 * Dynamic Client Registration (RFC 7591), which Claude and other MCP apps
 * use the first time they connect (#221). Only Claude's own callbacks and
 * the addresses added in Settings → MCP connector (#281) are accepted as
 * redirects, so no other site can use a registration to get a code.
 */
export async function POST(request: Request) {
  if (!(await connectorSince())) return new Response(null, { status: 404 });
  const body = registration.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_client_metadata", error_description: "Send redirect_uris." }, { status: 400 });
  const added = await addedRedirects();
  if (body.data.redirect_uris.some((uri) => !allowedRedirect(uri, added))) {
    return Response.json(
      { error: "invalid_redirect_uri", error_description: "Only Claude's callback addresses and those added in Dossier's Settings → MCP connector are allowed." },
      { status: 400 },
    );
  }
  const name = body.data.client_name?.trim() || (body.data.redirect_uris.every(isClaudeRedirect) ? "Claude" : "An app");
  const clientId = await registerClient({ name, redirectUris: body.data.redirect_uris });
  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: body.data.redirect_uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: { "cache-control": "no-store" } },
  );
}
