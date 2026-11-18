import { Bot, BriefcaseBusiness, FileText, Gauge, House, Inbox, Rocket, Search, Settings, UserRound, type LucideIcon } from "lucide-react";

// The app's sections, shared by the sidebar and the page bar so they always agree.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether the item is the current section; defaults to its own path and below. */
  isActive?: (pathname: string) => boolean;
};

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/**
 * The sections in groups, as the UI refresh has them (E27-3): Dashboard,
 * then what the user is tracking, where they find work, and their profiles.
 * The last group sits at the bottom.
 */
export const NAV: { label?: string; items: NavItem[]; profiles?: true }[] = [
  { items: [{ href: "/", label: "Dashboard", icon: House, isActive: (pathname) => pathname === "/" }] },
  {
    label: "Track",
    items: [
      {
        href: "/applications",
        label: "Applications",
        icon: BriefcaseBusiness,
        // A new application becomes one, so the flow belongs to Applications.
        isActive: (pathname) => within(pathname, "/applications") || within(pathname, "/new"),
      },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  {
    label: "Find work",
    items: [
      { href: "/jobs", label: "Positions", icon: Search },
      { href: "/startups", label: "Startups", icon: Rocket },
      { href: "/agent", label: "Agent", icon: Bot },
    ],
  },
  {
    label: "Your profiles",
    // The sidebar lists each profile here (E27-5); these two are the rail's icons and the page bar's sections.
    profiles: true,
    items: [
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/resume", label: "Base resume", icon: FileText },
    ],
  },
  {
    items: [
      // Tokens used per AI task (#290).
      { href: "/usage", label: "Usage", icon: Gauge },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const isCurrent = ({ href, isActive = (path) => within(path, href) }: NavItem, pathname: string) => isActive(pathname);

/** The section a path belongs to, for the page bar's title; undefined outside them all. */
export function currentSection(pathname: string): NavItem | undefined {
  return NAV.flatMap((group) => group.items).find((item) => isCurrent(item, pathname));
}
