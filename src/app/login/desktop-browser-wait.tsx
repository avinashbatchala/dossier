"use client";

import { useEffect } from "react";

/**
 * The sign-in page in the system browser, when Dossier runs in the desktop
 * app on this computer (#365): there's no password, so the app signs the
 * browser in. This page waits for that, then goes on by itself.
 */
export function DesktopBrowserWait({ next, expired }: { next: string; expired: boolean }) {
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        if (!stopped && response.ok) window.location.assign(next);
      } catch {
        // The app may be restarting; ask again.
      }
    };
    const timer = setInterval(check, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [next]);

  return (
    <div className="flex flex-col gap-3" role="status">
      <h1 className="font-serif text-section">Sign in from the Dossier app</h1>
      <p className="text-sm leading-[1.6] text-muted">
        {expired ? "That sign-in link was used or is too old. " : ""}Dossier runs in its app on this computer, without a password. To use it in
        this browser, open the Dossier app and choose <b className="font-medium text-ink">Help → Sign in my browser</b>. This page carries on
        by itself once it&apos;s done.
      </p>
    </div>
  );
}
