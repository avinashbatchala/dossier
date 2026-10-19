import type { ReactNode } from "react";

import { PageHeader } from "./page-header";

/**
 * A calm message in place of a screen (E11-4): something isn't there, or it
 * didn't load. Says what happened, then what to do next. In the app's panel
 * the title goes in the page bar; `standalone`, outside the app's shell, it
 * heads the message.
 */
export function ScreenMessage({
  title,
  children,
  actions,
  standalone = false,
}: {
  title: string;
  children: ReactNode;
  actions: ReactNode;
  standalone?: boolean;
}) {
  return (
    <>
      {!standalone && <PageHeader title={title} />}
      <section className={standalone ? "flex max-w-[680px] flex-col items-start gap-3 px-10 pt-12 pb-16" : "flex max-w-[680px] flex-col items-start gap-3 px-10 pb-16"}>
        {standalone && <h1 className="font-serif text-title text-pretty">{title}</h1>}
        <div className="flex flex-col gap-2 text-lead text-pretty text-muted">{children}</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">{actions}</div>
      </section>
    </>
  );
}
