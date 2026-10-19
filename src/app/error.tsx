"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

/** When a page outside the app's own screens fails, or the app shell itself (E11-4). */
export default function RootError(props: ErrorPageProps) {
  return (
    <main className="flex min-h-screen justify-center">
      <ScreenError {...props} standalone title="Dossier didn't load" />
    </main>
  );
}
