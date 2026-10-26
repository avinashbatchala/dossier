import { connectorSince, protectedResourceMetadata } from "@/lib/connector/oauth";
import { publicOrigin } from "@/lib/google/origin";

/** /.well-known/oauth-protected-resource (a rewrite in next.config.ts): who guards /api/mcp (#221). */
export async function GET(request: Request) {
  if (!(await connectorSince())) return new Response(null, { status: 404 });
  return Response.json(protectedResourceMetadata(publicOrigin(request)), { headers: { "access-control-allow-origin": "*" } });
}
