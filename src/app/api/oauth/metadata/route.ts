import { authorizationServerMetadata, connectorSince } from "@/lib/connector/oauth";
import { publicOrigin } from "@/lib/google/origin";

/** /.well-known/oauth-authorization-server (a rewrite in next.config.ts): how Claude signs in (#221). */
export async function GET(request: Request) {
  if (!(await connectorSince())) return new Response(null, { status: 404 });
  return Response.json(authorizationServerMetadata(publicOrigin(request)), { headers: { "access-control-allow-origin": "*" } });
}
