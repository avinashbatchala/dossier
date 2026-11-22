// What a window showing the user's server may do. The page comes from
// elsewhere, so it's treated like any web page.

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

const parse = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/** Whether the system browser may be handed this link. Anything else, such as file: or a custom scheme, could start another program. */
export function mayOpenExternally(url: string): boolean {
  const parsed = parse(url);
  return parsed !== null && EXTERNAL_SCHEMES.has(parsed.protocol);
}

export type Navigation = "stay" | "external" | "refuse";

/**
 * A navigation the page started. It stays in the window on the server, and on
 * the site the window is already showing, so a sign-in page in front of the
 * server keeps working. Links to anywhere else go to the system browser.
 */
export function navigationFor(target: string, { server, current }: { server: string; current: string }): Navigation {
  const url = parse(target);
  if (!url) return "refuse";
  if (url.protocol === "http:" || url.protocol === "https:") {
    return url.origin === server || url.origin === parse(current)?.origin ? "stay" : "external";
  }
  return url.protocol === "mailto:" ? "external" : "refuse";
}

/**
 * Connect Google on the server (#327): Google refuses its sign-in inside an
 * app, so it opens in the system browser instead. The path with its query, or
 * null for any other link.
 */
export function googleConnectPath(target: string, server: string): string | null {
  const url = parse(target);
  if (!url || url.origin !== server || url.pathname !== "/api/google/connect") return null;
  return `${url.pathname}${url.search}`;
}

/** A redirect from the server stays in the window, as a sign-in page in front of it needs, but only to a web address. */
export function redirectAllowed(target: string): boolean {
  const url = parse(target);
  return url?.protocol === "http:" || url?.protocol === "https:";
}

/** The only thing the page may ask for: the app's Copy buttons. */
export function permissionAllowed(permission: string): boolean {
  return permission === "clipboard-sanitized-write";
}
