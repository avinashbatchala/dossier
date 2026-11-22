import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { countPages, DocumentPreview } from "./document-preview";

afterEach(() => {
  vi.restoreAllMocks();
  for (const element of pages.splice(0)) element.remove();
});

const pages: HTMLElement[] = [];

/** A page 640 units wide at `unit` px each, `height` units tall, with 50 units of padding, on A4. */
function page(height: number, { unit = 0.5, pageHeight = 905 } = {}) {
  const element = document.createElement("article");
  element.style.setProperty("--page-height", String(pageHeight));
  element.style.setProperty("--paper-width", "210");
  element.style.setProperty("--paper-height", "297");
  element.style.setProperty("--pad-y", "50");
  Object.defineProperty(element, "offsetWidth", { value: 640 * unit });
  Object.defineProperty(element, "offsetHeight", { value: height * unit });
  // In the document, as on screen: a detached element has no computed style (jsdom 31, as browsers).
  document.body.append(element);
  pages.push(element);
  return element;
}

describe("countPages", () => {
  it("counts a page that isn't full as one", () => {
    expect(countPages(page(905))).toBe(1);
  });

  it("counts each page's content area, since print repeats the padding on every page", () => {
    // 805 units of content fit on a page, give or take rounding.
    expect(countPages(page(906))).toBe(1);
    expect(countPages(page(910))).toBe(2);
    expect(countPages(page(100 + 805 * 2))).toBe(2);
    expect(countPages(page(100 + 805 * 2 + 10))).toBe(3);
  });

  it("uses the paper's height", () => {
    expect(countPages(page(900, { pageHeight: 828 }))).toBe(2);
  });

  it("falls back to one page before layout", () => {
    expect(countPages(page(2000, { unit: 0 }))).toBe(1);
  });

  it("counts the sheets of a paged preview, laid out at the paper's exact height with a gap between", () => {
    // An A4 page is 905.14 units tall; 32 units of canvas between two.
    expect(countPages(page(905.14), { paged: true })).toBe(1);
    expect(countPages(page(905.14 * 2 + 32), { paged: true })).toBe(2);
    expect(countPages(page(905.14 * 3 + 64), { paged: true })).toBe(3);
  });
});

/** Lays a test page out `height` units tall at half size, as the preview measures it. */
function laidOut(height: number) {
  return (element: HTMLElement | null) => {
    if (!element) return;
    element.style.setProperty("--page-height", "905");
    element.style.setProperty("--paper-width", "210");
    element.style.setProperty("--paper-height", "297");
    element.style.setProperty("--pad-y", "50");
    Object.defineProperty(element, "offsetWidth", { value: 320 });
    Object.defineProperty(element, "offsetHeight", { value: height / 2 });
  };
}

describe("DocumentPreview", () => {
  it("shows the label and the page count above the page", () => {
    render(
      <DocumentPreview label="Editorial" meta={(pages) => `A4 · ${pages} page`}>
        <article aria-label="Resume" />
      </DocumentPreview>,
    );
    expect(screen.getByText("Editorial")).toBeInTheDocument();
    expect(screen.getByText("A4 · 1 page")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Resume" })).toBeInTheDocument();
  });

  it("shows a notice between the label row and the page, which can depend on the pages (E10-10)", () => {
    // A two-page resume, as laid out: the ref runs before the preview measures.
    render(
      <DocumentPreview label="Editorial" notice={(pages) => pages > 1 && <p>Runs over one page</p>}>
        <article aria-label="Resume" ref={laidOut(905.14 * 2 + 32)} />
      </DocumentPreview>,
    );
    expect(screen.getByText("Runs over one page")).toBeInTheDocument();
  });

  it("draws a sheet behind each page where the browser can page", () => {
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    const { container } = render(
      <DocumentPreview label="Editorial" meta={(pages) => `A4 · ${pages} pages`}>
        <article aria-label="Resume" ref={laidOut(905.14 * 2 + 32)} />
      </DocumentPreview>,
    );
    expect(screen.getByText("A4 · 2 pages")).toBeInTheDocument();
    const sheets = container.querySelectorAll("article ~ [aria-hidden]");
    expect(sheets).toHaveLength(2);
    expect((sheets[1] as HTMLElement).style.top).toMatch(/937\.14/);
  });

  it("marks where each page ends where it can't", () => {
    vi.spyOn(CSS, "supports").mockReturnValue(false);
    const { container } = render(
      <DocumentPreview label="Editorial" meta={(pages) => `A4 · ${pages} pages`}>
        <article aria-label="Resume" ref={laidOut(1000 * 2)} />
      </DocumentPreview>,
    );
    expect(screen.getByText("A4 · 3 pages")).toBeInTheDocument();
    const ends = [...container.querySelectorAll<HTMLElement>("[data-page]")];
    expect(ends.map((end) => end.dataset.page)).toEqual(["2", "3"]);
    // Each page holds 805 units below its 50 units of padding.
    expect(ends[0].style.top).toMatch(/855/);
  });
});
