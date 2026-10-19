import Link from "next/link";

import { ScreenMessage } from "@/components/screen-message";
import { buttonClassName } from "@/components/ui/button";

/** Addresses that don't match any page (E11-4). */
export default function NotFound() {
  return (
    <main className="flex min-h-screen justify-center">
      <ScreenMessage
        standalone
        title="There's no page here"
        actions={
          <Link href="/" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
            Go to the dashboard
          </Link>
        }
      >
        <p>The link may be old or mistyped. Everything you saved is where you left it.</p>
      </ScreenMessage>
    </main>
  );
}
