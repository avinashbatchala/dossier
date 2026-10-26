import { env } from "@/lib/env";

/**
 * The address the browser reaches Dossier at: DOSSIER_PUBLIC_URL, else the
 * forwarded host and protocol behind a reverse proxy, else the request's own.
 * Google's redirect and the Claude connector's addresses (#221) use it.
 */
export function publicOrigin(request: Request): string {
  if (env.DOSSIER_PUBLIC_URL) return env.DOSSIER_PUBLIC_URL;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
  return host ? `${protocol}://${host}` : url.origin;
}
