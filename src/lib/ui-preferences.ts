// How the app looks, as the browser last chose it: the colour scheme and
// whether the sidebar is collapsed. Both live in cookies, so the server
// renders the right one from the first paint, with no flash and no inline
// script. Read on the server and the client alike.

export const COLOR_SCHEME_COOKIE = "dossier_theme";
export const SIDEBAR_COOKIE = "dossier_sidebar";
/** The sidebar on an application's screen, kept apart so the document gets the room (E27-8). */
export const APPLICATION_SIDEBAR_COOKIE = "dossier_sidebar_application";
/** Whether the statuses under Applications are shown (E27-4). */
export const STATUSES_COOKIE = "dossier_sidebar_statuses";
/** Whether the open profile's Profile and Base resume are shown (E27-5). */
export const PROFILES_COOKIE = "dossier_sidebar_profiles";

export type ColorScheme = "light" | "dark";

/** The scheme the sidebar's switch chose; undefined follows the system. */
export function parseColorScheme(value: string | undefined): ColorScheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

/** Whether the sidebar was left collapsed. */
export function parseSidebarCollapsed(value: string | undefined): boolean {
  return value === "collapsed";
}

/** Whether the sidebar on an application's screen is collapsed: it is unless the user opened it there (E27-8). */
export function parseApplicationSidebarCollapsed(value: string | undefined): boolean {
  return value !== "expanded";
}

/** Whether a part of the sidebar that starts open, such as the statuses, was left open. */
export function parseOpen(value: string | undefined): boolean {
  return value !== "closed";
}

const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Remembers a preference for a year, from the browser. */
export function rememberPreference(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${YEAR_SECONDS}; samesite=lax`;
}
