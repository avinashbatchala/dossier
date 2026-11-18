"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, use, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { APPLICATION_SIDEBAR_COOKIE, rememberPreference, SIDEBAR_COOKIE } from "@/lib/ui-preferences";

const CollapsedContext = createContext<{ collapsed: boolean; expand: () => void }>({ collapsed: false, expand: () => {} });

/** Whether the sidebar is collapsed to its icons, for the parts that need more than CSS. */
export function useSidebarCollapsed(): boolean {
  return use(CollapsedContext).collapsed;
}

/** Opens a collapsed sidebar, for a part that needs its full width (the update notice). */
export function useExpandSidebar(): () => void {
  return use(CollapsedContext).expand;
}

/** An application's own screen, where the sidebar keeps its own state (E27-8); not the list, nor New application. */
const isApplicationScreen = (pathname: string | null) => /^\/applications\/[^/]+/.test(pathname ?? "");

/**
 * The sidebar's frame, collapsible to a strip of icons.
 * The choice is kept in a cookie, so the server renders the next page the
 * same way. An application's screen has its own, collapsed until the user
 * opens it there, so the document gets the room (E27-8); toggling one never
 * changes the other. Inside, `group-data-collapsed/sidebar:` variants hide
 * what doesn't fit, so the server-rendered parts need no state of their own.
 */
export function SidebarFrame({
  initialCollapsed,
  initialApplicationCollapsed = true,
  brand,
  children,
}: {
  initialCollapsed: boolean;
  /** On an application's screen. */
  initialApplicationCollapsed?: boolean;
  /** The logo, which the expand button replaces on hover while collapsed. */
  brand: ReactNode;
  children: ReactNode;
}) {
  const onApplication = isApplicationScreen(usePathname());
  const [elsewhere, setElsewhere] = useState(initialCollapsed);
  const [onScreen, setOnScreen] = useState(initialApplicationCollapsed);
  const collapsed = onApplication ? onScreen : elsewhere;
  const change = (next: boolean) => {
    (onApplication ? setOnScreen : setElsewhere)(next);
    rememberPreference(onApplication ? APPLICATION_SIDEBAR_COOKIE : SIDEBAR_COOKIE, next ? "collapsed" : "expanded");
  };
  const toggle = () => change(!collapsed);
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <CollapsedContext value={{ collapsed, expand: () => change(false) }}>
      <aside
        aria-label="Sidebar"
        data-collapsed={collapsed || undefined}
        className={cn(
          "group/sidebar sticky top-0 flex h-screen shrink-0 flex-col self-start overflow-x-hidden overflow-y-auto border-r border-line bg-sidebar motion-safe:transition-[width] motion-safe:duration-200",
          collapsed ? "w-[60px]" : "w-[264px]",
        )}
      >
        <div
          className={cn(
            "group/header relative flex items-center gap-2 border-b border-line",
            collapsed ? "justify-center px-1 py-3" : "pt-3 pr-3 pb-4 pl-4",
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2",
              // Collapsed, the logo and the expand button share one slot.
              collapsed &&
                "flex-none group-hover/header:opacity-0 group-has-[button:focus-visible]/header:opacity-0 motion-safe:transition-opacity",
            )}
          >
            {brand}
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink",
              collapsed &&
                "absolute inset-0 m-auto size-8 bg-surface opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 motion-safe:transition-opacity",
            )}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </aside>
    </CollapsedContext>
  );
}
