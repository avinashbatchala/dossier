"use client";

import { usePathname } from "next/navigation";

import { currentSection } from "@/lib/nav";

/** The current section's icon from the sidebar, at the start of the page bar. */
export function PageBarIcon() {
  // No path outside a router (e.g. in a test): then there's no section to show.
  const pathname = usePathname();
  const Icon = pathname ? currentSection(pathname)?.icon : undefined;
  return Icon ? <Icon size={26} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-muted" /> : null;
}
