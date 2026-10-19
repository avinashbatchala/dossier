"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";
import { COLOR_SCHEME_COOKIE, rememberPreference, type ColorScheme } from "@/lib/ui-preferences";

import { useSidebarCollapsed } from "./sidebar-frame";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  listeners.add(listener);
  return () => {
    query.removeEventListener("change", listener);
    listeners.delete(listener);
  };
}

/** The scheme showing now: the one chosen here, or else the system's. */
function currentScheme(): ColorScheme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * The sidebar's light/dark switch. It follows the
 * system until it's used, then remembers the choice in a cookie that the
 * root layout reads, so the next page load starts in the right scheme.
 */
export function ThemeToggle({ serverScheme }: { serverScheme?: ColorScheme }) {
  const collapsed = useSidebarCollapsed();
  // The server only knows a scheme that was chosen; for the system's it
  // guesses light, and the browser corrects it right after hydration.
  const scheme = useSyncExternalStore(subscribe, currentScheme, () => serverScheme ?? "light");
  const next: ColorScheme = scheme === "dark" ? "light" : "dark";
  const label = next === "dark" ? "Dark mode" : "Light mode";
  const Icon = next === "dark" ? Moon : Sun;

  const toggle = () => {
    document.documentElement.dataset.theme = next;
    rememberPreference(COLOR_SCHEME_COOKIE, next);
    listeners.forEach((listener) => listener());
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={collapsed ? label : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-left text-sm font-medium text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors",
        collapsed && "justify-center px-1.5",
      )}
    >
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{label}</span>
    </button>
  );
}
