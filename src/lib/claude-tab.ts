// A new tab for the claude.ai chat that takes over work Dossier has no AI
// model for (#221). Browsers only let a page open a tab during the click
// itself, so it's opened blank at once and sent on once the server says where.

/** A blank tab opened during the click; null when the browser refused it. */
export function openPendingTab(): Window | null {
  return window.open("about:blank", "_blank");
}

/** Sends the tab on to `url`, or opens it now when there's no tab. */
export function sendPendingTab(tab: Window | null, url: string): void {
  if (tab && !tab.closed) {
    tab.opener = null;
    tab.location.href = url;
  } else {
    window.open(url, "_blank", "noopener");
  }
}
