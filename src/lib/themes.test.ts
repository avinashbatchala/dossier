import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  BUILT_IN_THEMES,
  contrastRatio,
  DENSITIES,
  FIT_LEVELS,
  hasSidebar,
  printCss,
  readableOnWhite,
  resolveTheme,
  squeeze,
  unitsToMm,
  withoutSidebar,
} from "./themes";

const theme = (id: string) => BUILT_IN_THEMES.find((entry) => entry.id === id)!;

describe("resolveTheme", () => {
  it("sizes the name by the heading font", () => {
    expect(resolveTheme(theme("editorial")).name).toEqual({ size: 30, weight: 500 });
    expect(resolveTheme(theme("modern")).name).toEqual({ size: 25, weight: 600 });
  });

  it("left-aligns the header of sidebar layouts", () => {
    const classic = theme("classic");
    expect(resolveTheme(classic).centered).toBe(true);
    expect(resolveTheme({ ...classic, layout: "SPLIT" })).toMatchObject({ split: true, centered: false });
  });

  it("lets a layout override the theme's", () => {
    expect(resolveTheme(theme("modern"), "SINGLE").split).toBe(false);
    expect(resolveTheme(theme("editorial"), "SPLIT").split).toBe(true);
  });

  it("resolves the newer structures: sidebar side and tint, side headings, banner and timeline", () => {
    expect(resolveTheme(theme("studio"))).toMatchObject({ split: true, sidebarEnd: true, tintedSidebar: true, sideHeadings: false });
    expect(resolveTheme(theme("folio"))).toMatchObject({ split: false, sideHeadings: true });
    expect(resolveTheme(theme("atlas"))).toMatchObject({ banner: true, timeline: true, centered: true });
    expect(resolveTheme(theme("console")).heading.marker).toBe("band");
    expect(resolveTheme(theme("signal")).heading.marker).toBe("bar");
    // A tint only shows on a sidebar.
    expect(resolveTheme(theme("studio"), "SINGLE")).toMatchObject({ split: false, sidebarEnd: false, tintedSidebar: false });
  });

  it("puts white on dark accents and ink on light ones", () => {
    expect(resolveTheme(theme("signal")).onAccent).toBe("#ffffff");
    expect(resolveTheme({ ...theme("signal"), accent: "#f2c94c" }).onAccent).toBe("#1d1c1a");
  });

  it("puts the script fallbacks and a Greek face in the style of the font before the theme's fonts", () => {
    expect(resolveTheme(theme("technical"))).toMatchObject({
      headFamily: "var(--script-fonts), var(--typeface-greek-sans), var(--typeface-plex-mono)",
      bodyFamily: "var(--script-fonts), var(--typeface-greek-sans), var(--typeface-plex-sans)",
    });
    expect(resolveTheme(theme("editorial")).headFamily).toBe(
      "var(--script-fonts), var(--typeface-greek-serif), var(--typeface-newsreader)",
    );
  });
});

describe("layouts and colours", () => {
  it("folds only sidebars into a single column", () => {
    expect(withoutSidebar("SPLIT")).toBe("SINGLE");
    expect(withoutSidebar("SPLIT_END")).toBe("SINGLE");
    expect(withoutSidebar("SIDE_HEADINGS")).toBe("SIDE_HEADINGS");
    expect(hasSidebar("SIDE_HEADINGS")).toBe(false);
  });

  it("offers swatches that read as text on white, and tells light colours apart", () => {
    for (const accent of ACCENTS) expect(readableOnWhite(accent.value), accent.name).toBe(true);
    for (const theme of BUILT_IN_THEMES) expect(readableOnWhite(theme.accent), theme.name).toBe(true);
    expect(readableOnWhite("#f2c94c")).toBe(false);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
  });

  it("names every built-in uniquely, with its own id", () => {
    expect(new Set(BUILT_IN_THEMES.map((theme) => theme.id)).size).toBe(BUILT_IN_THEMES.length);
    expect(new Set(BUILT_IN_THEMES.map((theme) => theme.name)).size).toBe(BUILT_IN_THEMES.length);
  });
});

describe("printCss", () => {
  it("prints on the configured paper with the theme's padding as page margins", () => {
    // Regular: 50 × 54 units; a unit is 210 / 640 mm on A4.
    expect(printCss(theme("editorial"), "A4")).toMatch(
      /^@page \{ size: 210mm 297mm; margin: 16.406mm 17.719mm; \}\n:root \{ --u: 0.328125mm; \}\n/,
    );
    expect(printCss(theme("technical"), "LETTER")).toMatch(/^@page \{ size: 215.9mm 279.4mm; margin: 12.819mm 14.168mm; \}/);
  });

  it("converts page units to millimetres", () => {
    expect(unitsToMm(640, "A4")).toBe(210);
    expect(unitsToMm(640, "LETTER")).toBe(215.9);
  });
});

describe("squeeze (public issue 69)", () => {
  it("tightens the spacing first, then the line height, then the type, never under the floors", () => {
    const regular = DENSITIES.REGULAR;
    expect(squeeze(regular, 0)).toBe(regular);
    const levels = Array.from({ length: FIT_LEVELS }, (_, index) => squeeze(regular, index + 1));
    expect(levels[0]).toMatchObject({ paddingY: 35, gap: 12, itemGap: 7, lineHeight: regular.lineHeight, fontSize: regular.fontSize });
    expect(levels[1].lineHeight).toBeLessThan(regular.lineHeight);
    expect(levels[1].fontSize).toBe(regular.fontSize);
    expect(levels[2].fontSize).toBeLessThan(regular.fontSize);
    for (let index = 1; index < levels.length; index++) {
      for (const key of ["paddingY", "gap", "itemGap", "lineHeight", "fontSize"] as const) expect(levels[index][key]).toBeLessThanOrEqual(levels[index - 1][key]);
    }
    const tightest = squeeze(DENSITIES.COMPACT, FIT_LEVELS);
    expect(tightest.fontSize).toBeGreaterThanOrEqual(9.25);
    expect(tightest.lineHeight).toBeGreaterThanOrEqual(1.35);
    expect(tightest.paddingY).toBeGreaterThanOrEqual(28);
    expect(squeeze(regular, FIT_LEVELS + 5)).toEqual(squeeze(regular, FIT_LEVELS));
  });

  it("reaches the resolved theme and the print margins", () => {
    const editorial = theme("editorial");
    expect(resolveTheme(editorial, undefined, 2).density.gap).toBeLessThan(resolveTheme(editorial).density.gap);
    expect(printCss(editorial, "A4", 1)).toContain(`margin: ${unitsToMm(35, "A4")}mm`);
    expect(printCss(editorial, "A4")).toContain(`margin: ${unitsToMm(50, "A4")}mm`);
  });
});
