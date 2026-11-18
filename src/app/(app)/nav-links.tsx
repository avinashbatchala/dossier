"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { statusParamValue, type StatusParam } from "@/lib/applications-list";
import { cn } from "@/lib/cn";
import { isCurrent, NAV, type NavItem } from "@/lib/nav";
import { rememberPreference, STATUSES_COOKIE } from "@/lib/ui-preferences";

import { useSidebarCollapsed } from "./sidebar-frame";
import { SidebarProfiles, type ProfilesNav } from "./sidebar-profiles";

/** What the sidebar shows under Applications (E27-4). */
export type ApplicationsNav = {
  /** Every application that isn't archived. */
  total: number;
  /** Draft to Offer, then Closed, each with its count and link. */
  statuses: { status: StatusParam; label: string; color: string; count: number; href: string }[];
  /** Whether the statuses were left showing. */
  open: boolean;
};

/** A nav item's look: the current page is a raised chip (E27-3), and keeps its look under the pointer. */
function itemClassName({ active, collapsed, strong = false }: { active: boolean; collapsed: boolean; strong?: boolean }) {
  return cn(
    "flex items-center gap-2 rounded-control border px-2.5 py-[6px] text-sm motion-safe:transition-colors",
    collapsed && "relative justify-center px-1.5",
    // One or the other: cn() doesn't merge, so both would leave the CSS order to pick.
    active
      ? "border-line-nav-active bg-nav-active font-medium text-ink shadow-raised"
      : cn("border-transparent hover:bg-hover hover:text-ink", strong ? "font-medium text-ink" : "text-muted"),
  );
}

/** The sidebar's navigation, with the current section highlighted. */
export function NavLinks({
  counts,
  applications,
  profiles,
}: { counts?: Record<string, number>; applications?: ApplicationsNav; profiles?: ProfilesNav } = {}) {
  const collapsed = useSidebarCollapsed();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      {NAV.map(({ label, items, profiles: profileGroup }, index) =>
        // Each profile by name (E27-5); the rail keeps the two icons.
        profileGroup && profiles && !collapsed ? (
          <div key={label} className="flex flex-col gap-0.5">
            <SidebarProfiles {...profiles} />
          </div>
        ) : (
        <div
          key={label ?? index}
          className={cn(
            "flex flex-col gap-0.5",
            index === NAV.length - 1 && cn("mt-auto border-t border-line pt-2", collapsed ? "-mx-1 px-1" : "-mx-2 px-2"),
          )}
        >
          {label &&
            (collapsed ? (
              // Holds the label's place, so the groups stay apart with the labels hidden.
              <div aria-hidden="true" className="mx-2 my-[15px] h-px bg-line-card" />
            ) : (
              <div className="px-2.5 pt-3.5 pb-1 text-xs font-medium text-muted">{label}</div>
            ))}
          {items.map((item) =>
            item.href === "/applications" && applications ? (
              <ApplicationsItem key={item.href} item={item} applications={applications} />
            ) : (
              <NavItemLink key={item.href} item={item} count={counts?.[item.href]} />
            ),
          )}
        </div>
        ),
      )}
    </nav>
  );
}

function NavItemLink({ item, count }: { item: NavItem; count?: number }) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const { href, label, icon: Icon } = item;
  const active = isCurrent(item, pathname);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className={itemClassName({ active, collapsed })}
    >
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{label}</span>
      {count ? (
        <span
          className={cn(
            "ml-auto rounded-full bg-primary px-1.5 text-[11px] leading-[18px] font-semibold text-on-primary",
            collapsed && "absolute ml-0 translate-x-2.5 -translate-y-2",
          )}
        >
          {count}
          <span className="sr-only"> waiting</span>
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Applications with its count, and its statuses under it (E27-4): each one
 * opens the list of that status. While a status is open, it's the current
 * item and Applications is set in ink instead.
 */
function ApplicationsItem({ item, applications }: { item: NavItem; applications: ApplicationsNav }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const collapsed = useSidebarCollapsed();
  const [open, setOpen] = useState(applications.open);
  const toggle = () => {
    setOpen(!open);
    rememberPreference(STATUSES_COOKIE, open ? "closed" : "open");
  };

  const { href, label, icon: Icon } = item;
  const inSection = isCurrent(item, pathname);
  const openStatus = pathname === "/applications" ? searchParams.get("status")?.toLowerCase() : undefined;
  const statusShown = applications.statuses.some(({ status }) => statusParamValue(status) === openStatus);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <>
      <div className="relative flex">
        <Link
          href={href}
          aria-current={inSection && !statusShown ? "page" : undefined}
          title={collapsed ? label : undefined}
          className={cn(itemClassName({ active: inSection && !statusShown, collapsed, strong: statusShown }), "flex-1", !collapsed && "pr-8")}
        >
          <Icon size={16} aria-hidden="true" className="shrink-0" />
          <span className={cn(collapsed ? "sr-only" : "flex-1")}>{label}</span>
          {!collapsed && (
            // The statuses below say the counts; the link's name stays "Applications".
            <span aria-hidden="true" className="text-xs font-normal text-muted tabular-nums">
              {applications.total}
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls="sidebar-statuses"
            aria-label={open ? "Hide statuses" : "Show statuses"}
            title={open ? "Hide statuses" : "Show statuses"}
            className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
          >
            <Chevron size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {!collapsed && open && (
        <ul id="sidebar-statuses" aria-label="Applications by status" className="mb-1 ml-[18px] flex flex-col border-l border-line-card pl-[9px]">
          {applications.statuses.map(({ status, label: name, color, count, href: statusHref }) => {
            const current = statusParamValue(status) === openStatus;
            return (
              <li key={status}>
                <Link
                  href={statusHref}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-[6px] px-2 py-[5px] text-[13px] motion-safe:transition-colors",
                    current ? "bg-selected font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink",
                  )}
                >
                  <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full" style={{ background: color }} />
                  <span className="flex-1">{name}</span>
                  {/* Muted text is too faint on a selected row (globals.css): ink there. */}
                  <span className={cn("tabular-nums", current ? "text-ink" : "text-muted")}>{count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
