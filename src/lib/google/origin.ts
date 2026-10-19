import type { NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * The address the browser reaches Dossier at: DOSSIER_PUBLIC_URL, else the
 * forwarded host and protocol behind a reverse proxy, else the request's own.
 */
export function publicOrigin(request: NextRequest): string {
  if (env.DOSSIER_PUBLIC_URL) return env.DOSSIER_PUBLIC_URL;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(/:$/, "");
  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}
