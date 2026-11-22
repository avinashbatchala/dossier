"use client";

import type { ReactNode } from "react";

import { rememberInstalledPortals, type PortalInfo } from "@/lib/job-search/sources";

/**
 * Makes the portals the user added (E23-3) known in the browser, before the
 * screen renders: their names, credits and posting pages, which postings and
 * filters show. The built-ins are known already.
 */
export function PortalRegistry({ portals, children }: { portals: PortalInfo[]; children: ReactNode }) {
  rememberInstalledPortals(portals);
  return children;
}
