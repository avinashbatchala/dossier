import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** One step on the way to a page: a link, or the page itself when it's last. */
export type Crumb = {
  label: ReactNode;
  href?: string;
  /** Instead of following the link, e.g. a step back inside the page. */
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  /** After the label, outside the link: "· interview tomorrow". */
  extra?: ReactNode;
  /** Only for screen readers: the page's own heading shows it just below. */
  hidden?: boolean;
};

/**
 * Where a page sits (#514, public #112): its parents as links, separated by
 * "/", and the page itself last with `aria-current="page"`. Used on every
 * page below a top-level one.
 */
export function Breadcrumb({ items, className }: { items: readonly Crumb[]; className?: string }) {
  const shown = items.filter((item) => !item.hidden);
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const separator = !item.hidden && shown.indexOf(item) > 0;
          return (
            <li key={index} className={cn(item.hidden ? "sr-only" : "flex min-w-0 items-center gap-1.5", last && !item.hidden && "truncate")} aria-current={last ? "page" : undefined}>
              {separator && <span aria-hidden="true">/</span>}
              <span className="min-w-0 truncate">
                {last || !item.href ? (
                  item.label
                ) : (
                  <Link href={item.href} onClick={item.onClick} className="text-muted hover:text-ink">
                    {item.label}
                  </Link>
                )}
                {item.extra}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
