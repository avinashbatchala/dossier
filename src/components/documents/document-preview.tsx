"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { PAGE_WIDTH } from "@/lib/themes";

import styles from "./document.module.css";

/** The canvas between two sheets of a paged preview, in page units. */
export const SHEET_GAP = 32;

const never = () => () => {};

/** Whether the browser can lay a document out on sheets (column-wrap, Chromium 145+). */
function canPage(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("column-wrap", "wrap");
}

/**
 * The page's height in page units. A paged preview lays the page out at the
 * paper's exact size, which the rounded --page-height is a fraction off.
 */
function pageHeightOf(style: CSSStyleDeclaration, paged: boolean): number {
  const number = (name: string) => Number(style.getPropertyValue(name)) || 0;
  if (!paged) return number("--page-height");
  const width = number("--paper-width");
  return width ? (PAGE_WIDTH * number("--paper-height")) / width : 0;
}

/**
 * How many printed pages a rendered document fills. Printing turns the page
 * padding into margins on every page (printCss), so each page holds its
 * height minus the padding above and below. On a paged preview, each page's
 * bottom margin, the canvas and the next page's top margin come between two
 * pages' content.
 */
export function countPages(page: HTMLElement, { paged = false } = {}): number {
  const unit = page.offsetWidth / PAGE_WIDTH;
  if (!unit) return 1;
  const style = getComputedStyle(page);
  const padding = Number(style.getPropertyValue("--pad-y")) * 2;
  const between = paged ? padding + SHEET_GAP : 0;
  const content = page.offsetHeight / unit - padding;
  const perPage = pageHeightOf(style, paged) - padding;
  if (!(perPage > 0)) return 1;
  // offsetHeight is rounded to whole pixels (up to 2 units), so a full page
  // doesn't count as two.
  return Math.max(1, Math.ceil((content + between - 2) / (perPage + between)));
}

/**
 * A document on the grey canvas, scaled to fit the column (up to its real
 * size) with container units, and a label row above it. Where the browser
 * can, the document is laid out on the sheets it prints on and breaks where
 * the PDF does (document.module.css, "Paged preview"); elsewhere it's one long
 * page with a line where each page ends. `meta` can depend on the number of
 * pages the document fills.
 */
export function DocumentPreview({
  label,
  meta,
  notice,
  className,
  children,
}: {
  label: ReactNode;
  meta?: ReactNode | ((pages: number) => ReactNode);
  /** A note between the label row and the page, e.g. what was left out to fit the page limit. */
  notice?: ReactNode | ((pages: number) => ReactNode);
  className?: string;
  /** A document component, e.g. ResumeDocument. */
  children: ReactNode;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const paged = useSyncExternalStore(never, canPage, () => false);
  const [pages, setPages] = useState(1);
  // The page's height and top padding in page units, for the sheets and page-end lines.
  const [pageHeight, setPageHeight] = useState(0);
  const [padY, setPadY] = useState(0);

  // After every render, since a new theme can change the page padding
  // without changing its height, and whenever the page's size changes, e.g.
  // once the fonts have loaded. A paged preview has a fixed size, so the
  // page itself is watched too.
  useLayoutEffect(() => {
    const measure = () => {
      const page = pageRef.current?.firstElementChild;
      if (!(page instanceof HTMLElement)) return;
      const style = getComputedStyle(page);
      setPages(countPages(page, { paged }));
      setPageHeight(pageHeightOf(style, paged));
      setPadY(Number(style.getPropertyValue("--pad-y")) || 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (pageRef.current) observer.observe(pageRef.current);
    if (pageRef.current?.firstElementChild) observer.observe(pageRef.current.firstElementChild);
    return () => observer.disconnect();
  });

  const sheets = paged && pageHeight > 0;
  return (
    <div
      className={cn(
        "@container flex min-w-0 flex-[999_1_480px] flex-col items-center overflow-auto bg-canvas px-10 pt-10 pb-16",
        className,
      )}
    >
      <div className="flex flex-col gap-4" style={{ "--u": "min(1px, calc(100cqw / 640))" } as CSSProperties}>
        <div className="flex w-[calc(var(--u)*640)] justify-between gap-3 text-meta text-muted">
          <span>{label}</span>
          <span>{typeof meta === "function" ? meta(pages) : meta}</span>
        </div>
        {notice && <div className="w-[calc(var(--u)*640)]">{typeof notice === "function" ? notice(pages) : notice}</div>}
        <div
          ref={pageRef}
          className={cn("relative isolate w-fit", paged ? styles.paged : "shadow-page")}
          style={
            {
              "--sheet-gap": SHEET_GAP,
              // The page is shrunk from the paper's size, so the sheets give the preview its size.
              ...(sheets && {
                width: "calc(var(--u) * 640)",
                height: `calc(var(--u) * ${pages * pageHeight + (pages - 1) * SHEET_GAP})`,
              }),
            } as CSSProperties
          }
        >
          {children}
          {sheets &&
            Array.from({ length: pages }, (_, index) => (
              <div
                key={index}
                aria-hidden
                className={styles.sheet}
                style={{ top: `calc(var(--u) * ${index * (pageHeight + SHEET_GAP)})`, height: `calc(var(--u) * ${pageHeight})` }}
              />
            ))}
          {!paged &&
            pageHeight > 0 &&
            Array.from({ length: pages - 1 }, (_, index) => (
              <div
                key={index}
                aria-hidden
                className={styles.pageEnd}
                data-page={index + 2}
                style={{ top: `calc(var(--u) * ${padY + (index + 1) * (pageHeight - 2 * padY)})` }}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
