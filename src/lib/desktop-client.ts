// The desktop app's window on a server (#359). It adds this to its user
// agent, so a sign-in from it keeps its session across launches: the app
// drops session cookies when it quits, as a browser does. Kept in step with
// DESKTOP_CLIENT in desktop/src/main.ts.

const DESKTOP_CLIENT = "DossierDesktop";

/** Whether a request comes from the desktop app's window. */
export function isDesktopClient(userAgent: string | null | undefined): boolean {
  return Boolean(userAgent) && new RegExp(`\\b${DESKTOP_CLIENT}/\\S+`).test(userAgent!);
}
