"use client";

import { ChevronDown, ChevronRight, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PROFILES_COOKIE, rememberPreference } from "@/lib/ui-preferences";

import { NewProfileDialog } from "./profile/profile-switcher";

/** What the sidebar shows under "Your profiles" (E27-5). */
export type ProfilesNav = {
  /** Every profile, the default (first) one first, with its strength from 0 to 100. */
  profiles: { id: string; name: string; strength: number }[];
  /** The one Profile and Base resume open: the last one opened. */
  openId: string;
  /** Whether its Profile and Base resume were left showing. */
  expanded: boolean;
};

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/**
 * "Your profiles" (E27-5): a row per profile. The open one shows Profile,
 * with a small strength bar, and Base resume; clicking another opens it on
 * Profile, as the switcher does. There's no global switch: applications
 * keep the profile they were made from. "+" makes a new one.
 */
export function SidebarProfiles({ profiles, openId, expanded: initiallyExpanded }: ProfilesNav) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [adding, setAdding] = useState(false);

  const onProfile = within(pathname, "/profile");
  const onResume = within(pathname, "/resume");
  // The page names the profile it opens before the layout's setting has caught up.
  const asked = onProfile || onResume ? searchParams.get("profile") : null;
  const open = profiles.find((profile) => profile.id === asked) ?? profiles.find((profile) => profile.id === openId) ?? profiles[0];
  const toggle = () => {
    setExpanded(!expanded);
    rememberPreference(PROFILES_COOKIE, expanded ? "closed" : "open");
  };

  return (
    <>
      <div className="flex items-center pt-3.5 pr-1 pb-1 pl-2.5 text-xs font-medium text-muted">
        <span className="flex-1">Your profiles</span>
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="New profile"
          title="New profile"
          className="grid size-6 place-items-center rounded-[6px] hover:bg-hover hover:text-ink"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      <ul aria-label="Your profiles" className="flex flex-col gap-0.5">
        {profiles.map((profile, index) => {
          const isOpen = profile.id === open?.id;
          const here = isOpen && (onProfile || onResume);
          const Chevron = expanded ? ChevronDown : ChevronRight;
          return (
            <li key={profile.id} className="flex flex-col">
              <div className="relative flex">
                <Link
                  href={`/profile?profile=${profile.id}`}
                  aria-current={here && !expanded ? "page" : undefined}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-control border py-[6px] pr-8 pl-2.5 text-sm motion-safe:transition-colors",
                    here && !expanded
                      ? "border-line-nav-active bg-nav-active font-medium text-ink shadow-raised"
                      : cn("border-transparent hover:bg-hover hover:text-ink", isOpen ? "text-ink" : "text-muted"),
                    isOpen && "font-medium",
                  )}
                >
                  <UserRound size={16} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                  {index === 0 && profiles.length > 1 && <span className="text-[11px] font-normal text-muted">Default</span>}
                  {!isOpen && <ChevronRight size={14} aria-hidden="true" className="absolute right-2 text-muted" />}
                </Link>
                {isOpen && (
                  <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={expanded}
                    aria-controls={`sidebar-profile-${profile.id}`}
                    aria-label={expanded ? `Hide ${profile.name}'s pages` : `Show ${profile.name}'s pages`}
                    title={expanded ? "Hide" : "Show"}
                    className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink"
                  >
                    <Chevron size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              {isOpen && expanded && (
                <ul id={`sidebar-profile-${profile.id}`} aria-label={`${profile.name}'s pages`} className="mb-1 ml-[18px] flex flex-col border-l border-line-card pl-[9px]">
                  <li>
                    <SubLink href={`/profile?profile=${profile.id}`} current={here && onProfile}>
                      <span className="flex-1">Profile</span>
                      <span
                        role="img"
                        aria-label={`${profile.strength}% complete`}
                        title={`${profile.strength}% complete`}
                        className="flex h-1 w-[30px] overflow-hidden rounded-full bg-track"
                      >
                        <span className="h-full rounded-full bg-success" style={{ width: `${profile.strength}%` }} />
                      </span>
                    </SubLink>
                  </li>
                  <li>
                    <SubLink href={`/resume?profile=${profile.id}`} current={here && onResume}>
                      Base resume
                    </SubLink>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {adding && open && <NewProfileDialog profiles={profiles} current={open} onClose={() => setAdding(false)} />}
    </>
  );
}

function SubLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-[6px] px-2 py-[5px] text-[13px] motion-safe:transition-colors",
        current ? "bg-selected font-medium text-ink" : "text-muted hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
