"use client";

import { ArrowUpRight, Coffee, MessagesSquare, Star, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { COFFEE_URL, DISCORD_URL, REPOSITORY_URL } from "@/lib/releases";

import { useSidebarCollapsed } from "./sidebar-frame";

/** A sidebar link that opens outside Dossier, in a new tab; icon-only with a tooltip while collapsed. */
function ExternalSidebarLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  const collapsed = useSidebarCollapsed();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={collapsed ? label : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors",
        collapsed && "justify-center px-1.5",
      )}
    >
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{label}</span>{" "}
      <span className="sr-only">(opens in a new tab)</span>
      {!collapsed && <ArrowUpRight size={14} aria-hidden="true" className="ml-auto shrink-0" />}
    </a>
  );
}

/** The sidebar's link to Dossier's repository, for credits and support. */
export function RepositoryLink() {
  return <ExternalSidebarLink href={REPOSITORY_URL} label="Star on GitHub" icon={Star} />;
}

/** The sidebar's link to the maintainer's Buy Me a Coffee page, for donations. */
export function CoffeeLink() {
  return <ExternalSidebarLink href={COFFEE_URL} label="Buy me a coffee" icon={Coffee} />;
}

/** The sidebar's invite to Dossier's Discord server. */
export function DiscordLink() {
  return <ExternalSidebarLink href={DISCORD_URL} label="Join us on Discord" icon={MessagesSquare} />;
}
