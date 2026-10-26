import {
  DateStyle,
  Density,
  HeaderStyle,
  HeadingStyle,
  PaperSize,
  PhotoPosition,
  PhotoShape,
  SidebarStyle,
  ThemeAlign,
  ThemeFont,
  ThemeLayout,
} from "@/generated/prisma/enums";

// Resume themes (RES-2…RES-4) and the page geometry every document shares.
// The numbers come from the prototype (`H`, `D` and `FONTS` in
// design/Dossier.dc.html) and are in page units: a page is 640 units wide, and
// the `--u` custom property says how big a unit is where the page is shown.

/** A theme as documents and the theme panels use it; a Theme row fits. */
export type ThemeData = {
  id: string;
  name: string;
  builtIn: boolean;
  headFont: ThemeFont;
  bodyFont: ThemeFont;
  /** "#rrggbb" */
  accent: string;
  layout: ThemeLayout;
  align: ThemeAlign;
  headingStyle: HeadingStyle;
  density: Density;
  headerStyle: HeaderStyle;
  sidebarStyle: SidebarStyle;
  dateStyle: DateStyle;
  /** The profile photo's shape and place (#224). */
  photoShape: PhotoShape;
  photoPosition: PhotoPosition;
};

/** What a theme that doesn't say otherwise has: the look of the first six built-ins. */
export const THEME_STYLE_DEFAULTS = {
  headerStyle: HeaderStyle.PLAIN,
  sidebarStyle: SidebarStyle.PLAIN,
  dateStyle: DateStyle.INLINE,
  photoShape: PhotoShape.CIRCLE,
  photoPosition: PhotoPosition.HEADER_END,
} satisfies Partial<ThemeData>;
type StyleField = keyof typeof THEME_STYLE_DEFAULTS;

/** The built-in themes, in the order the theme picker shows them (RES-2). */
export const BUILT_IN_THEMES: ThemeData[] = (
  [
    { id: "editorial", name: "Editorial", headFont: "NEWSREADER", bodyFont: "GEIST", accent: "#7a3b2e", layout: "SINGLE", align: "LEFT", headingStyle: "PLAIN", density: "REGULAR" },
    { id: "classic", name: "Classic", headFont: "GARAMOND", bodyFont: "GARAMOND", accent: "#1d1c1a", layout: "SINGLE", align: "CENTER", headingStyle: "RULE", density: "REGULAR", photoPosition: "ABOVE_NAME" },
    { id: "modern", name: "Modern", headFont: "GEIST", bodyFont: "GEIST", accent: "#2f5d8a", layout: "SPLIT", align: "LEFT", headingStyle: "CAPS", density: "REGULAR", photoShape: "ROUNDED", photoPosition: "SIDEBAR" },
    { id: "minimal", name: "Minimal", headFont: "PLEX_SANS", bodyFont: "PLEX_SANS", accent: "#6f6a62", layout: "SINGLE", align: "LEFT", headingStyle: "CAPS", density: "AIRY", photoShape: "SQUARE" },
    { id: "technical", name: "Technical", headFont: "PLEX_MONO", bodyFont: "PLEX_SANS", accent: "#2d6a4f", layout: "SPLIT", align: "LEFT", headingStyle: "RULE", density: "COMPACT", photoShape: "SQUARE", photoPosition: "SIDEBAR" },
    { id: "ledger", name: "Ledger", headFont: "NEWSREADER", bodyFont: "PLEX_SANS", accent: "#1d1c1a", layout: "SPLIT", align: "LEFT", headingStyle: "RULE", density: "COMPACT", photoShape: "PORTRAIT" },
    { id: "signal", name: "Signal", headFont: "MANROPE", bodyFont: "MANROPE", accent: "#1f3a5f", layout: "SINGLE", align: "LEFT", headingStyle: "BAR", density: "REGULAR", headerStyle: "BANNER", photoPosition: "HEADER_START" },
    { id: "studio", name: "Studio", headFont: "SPACE_GROTESK", bodyFont: "INTER", accent: "#1f6f6b", layout: "SPLIT_END", align: "LEFT", headingStyle: "CAPS", density: "REGULAR", sidebarStyle: "TINTED", photoPosition: "SIDEBAR" },
    { id: "chronicle", name: "Chronicle", headFont: "FRAUNCES", bodyFont: "SOURCE_SERIF", accent: "#7b2337", layout: "SINGLE", align: "LEFT", headingStyle: "RULE", density: "REGULAR", dateStyle: "TIMELINE", photoShape: "PORTRAIT" },
    { id: "folio", name: "Folio", headFont: "PLAYFAIR", bodyFont: "LORA", accent: "#1d1c1a", layout: "SIDE_HEADINGS", align: "LEFT", headingStyle: "PLAIN", density: "AIRY", photoShape: "ROUNDED", photoPosition: "HEADER_START" },
    { id: "console", name: "Console", headFont: "JETBRAINS_MONO", bodyFont: "WORK_SANS", accent: "#4a5563", layout: "SPLIT", align: "LEFT", headingStyle: "BAND", density: "COMPACT", sidebarStyle: "TINTED", photoShape: "SQUARE", photoPosition: "SIDEBAR" },
    { id: "atlas", name: "Atlas", headFont: "LIBRE_CASLON", bodyFont: "INTER", accent: "#a14a1f", layout: "SINGLE", align: "CENTER", headingStyle: "CAPS", density: "REGULAR", headerStyle: "BANNER", dateStyle: "TIMELINE", photoPosition: "ABOVE_NAME" },
  ] satisfies (Omit<ThemeData, "builtIn" | StyleField> & Partial<Pick<ThemeData, StyleField>>)[]
).map((theme) => ({ ...THEME_STYLE_DEFAULTS, ...theme, builtIn: true }));

/** The page is this many units wide, whatever the paper. */
export const PAGE_WIDTH = 640;

/** Paper sizes (SET-6), with their height in page units. */
export const PAPER_SIZES: Record<
  PaperSize,
  { label: string; widthMm: number; heightMm: number; pageHeight: number }
> = {
  [PaperSize.A4]: { label: "A4", widthMm: 210, heightMm: 297, pageHeight: 905 },
  [PaperSize.LETTER]: { label: "US Letter", widthMm: 215.9, heightMm: 279.4, pageHeight: 828 },
};

/**
 * The fonts a theme can use, in the order the theme builder lists them. The
 * families are the bundled fonts' --typeface-* variables (src/fonts).
 */
export const THEME_FONTS: Record<ThemeFont, { label: string; family: string; serif: boolean }> = {
  [ThemeFont.NEWSREADER]: { label: "Newsreader", family: "var(--typeface-newsreader)", serif: true },
  [ThemeFont.GARAMOND]: { label: "Garamond", family: "var(--typeface-eb-garamond)", serif: true },
  [ThemeFont.SOURCE_SERIF]: { label: "Source Serif", family: "var(--typeface-source-serif)", serif: true },
  [ThemeFont.LORA]: { label: "Lora", family: "var(--typeface-lora)", serif: true },
  [ThemeFont.LIBRE_CASLON]: { label: "Caslon", family: "var(--typeface-libre-caslon)", serif: true },
  [ThemeFont.PLAYFAIR]: { label: "Playfair", family: "var(--typeface-playfair)", serif: true },
  [ThemeFont.FRAUNCES]: { label: "Fraunces", family: "var(--typeface-fraunces)", serif: true },
  [ThemeFont.GEIST]: { label: "Geist", family: "var(--typeface-geist)", serif: false },
  [ThemeFont.PLEX_SANS]: { label: "Plex Sans", family: "var(--typeface-plex-sans)", serif: false },
  [ThemeFont.INTER]: { label: "Inter", family: "var(--typeface-inter)", serif: false },
  [ThemeFont.MANROPE]: { label: "Manrope", family: "var(--typeface-manrope)", serif: false },
  [ThemeFont.WORK_SANS]: { label: "Work Sans", family: "var(--typeface-work-sans)", serif: false },
  [ThemeFont.SPACE_GROTESK]: { label: "Space Grotesk", family: "var(--typeface-space-grotesk)", serif: false },
  [ThemeFont.PLEX_MONO]: { label: "Plex Mono", family: "var(--typeface-plex-mono)", serif: false },
  [ThemeFont.JETBRAINS_MONO]: { label: "JetBrains Mono", family: "var(--typeface-jetbrains-mono)", serif: false },
};

/**
 * The theme builder's accent colours (RES-3), with names for people who
 * can't see them. Each reads as text on white (4.5:1 or more); any other
 * colour can be picked too.
 */
export const ACCENTS = [
  { value: "#1d1c1a", name: "Ink" },
  { value: "#4a5563", name: "Slate" },
  { value: "#1f3a5f", name: "Navy" },
  { value: "#2f5d8a", name: "Blue" },
  { value: "#1f6f6b", name: "Teal" },
  { value: "#2d6a4f", name: "Green" },
  { value: "#9a6b1f", name: "Ochre" },
  { value: "#a14a1f", name: "Rust" },
  { value: "#7a3b2e", name: "Brick" },
  { value: "#7b2337", name: "Burgundy" },
  { value: "#a3405f", name: "Rose" },
  { value: "#6b4f8a", name: "Plum" },
] as const;

/** The document ink, for text on light accents. */
const INK = "#1d1c1a";

/** Relative luminance of a "#rrggbb" colour (WCAG 2). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two "#rrggbb" colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Whether an accent is dark enough for small text on white (4.5:1). */
export const readableOnWhite = (accent: string) => contrastRatio(accent, "#ffffff") >= 4.5;

/** A colour's name: an accent swatch's, Minimal's grey, or else its hex value. */
export function accentName(accent: string): string {
  const value = accent.toLowerCase();
  if (value === "#6f6a62") return "Stone";
  return ACCENTS.find((entry) => entry.value === value)?.name ?? value;
}

/**
 * Section titles: underlined, small caps or plain, or small caps after an
 * accent bar or on a pale band of the accent (document.module.css draws those two).
 */
export const HEADING_STYLES: Record<
  HeadingStyle,
  {
    label: string;
    size: number;
    weight: number;
    uppercase: boolean;
    tracking: string;
    rule: boolean;
    padding: number;
    marker?: "bar" | "band";
  }
> = {
  [HeadingStyle.RULE]: { label: "Underlined", size: 12, weight: 600, uppercase: false, tracking: "0", rule: true, padding: 3 },
  [HeadingStyle.CAPS]: { label: "Small caps", size: 9.5, weight: 600, uppercase: true, tracking: ".14em", rule: false, padding: 0 },
  [HeadingStyle.PLAIN]: { label: "Plain", size: 15, weight: 500, uppercase: false, tracking: "-.005em", rule: false, padding: 0 },
  [HeadingStyle.BAR]: { label: "Accent bar", size: 9.5, weight: 700, uppercase: true, tracking: ".14em", rule: false, padding: 0, marker: "bar" },
  [HeadingStyle.BAND]: { label: "Tinted band", size: 9.5, weight: 600, uppercase: true, tracking: ".14em", rule: false, padding: 0, marker: "band" },
};

/** Spacing: page padding, gaps between sections and items, body text size and line height. */
export const DENSITIES: Record<
  Density,
  { label: string; paddingY: number; paddingX: number; gap: number; fontSize: number; lineHeight: number; itemGap: number }
> = {
  [Density.COMPACT]: { label: "Compact", paddingY: 38, paddingX: 42, gap: 14, fontSize: 9.5, lineHeight: 1.42, itemGap: 7 },
  [Density.REGULAR]: { label: "Regular", paddingY: 50, paddingX: 54, gap: 20, fontSize: 10.5, lineHeight: 1.5, itemGap: 10 },
  [Density.AIRY]: { label: "Airy", paddingY: 62, paddingX: 64, gap: 26, fontSize: 10.5, lineHeight: 1.65, itemGap: 13 },
};

export const LAYOUTS: Record<ThemeLayout, { label: string }> = {
  [ThemeLayout.SINGLE]: { label: "Single column" },
  [ThemeLayout.SIDE_HEADINGS]: { label: "Side headings" },
  [ThemeLayout.SPLIT]: { label: "Sidebar left" },
  [ThemeLayout.SPLIT_END]: { label: "Sidebar right" },
};

/** Whether a layout has a sidebar. */
export const hasSidebar = (layout: ThemeLayout) => layout === ThemeLayout.SPLIT || layout === ThemeLayout.SPLIT_END;

/**
 * The layout with its sidebar folded into the single column: a tailored
 * resume's, unless it follows the theme's layout (APP-4). Other layouts stay.
 */
export const withoutSidebar = (layout: ThemeLayout) => (hasSidebar(layout) ? ThemeLayout.SINGLE : layout);

export const ALIGNMENTS: Record<ThemeAlign, { label: string }> = {
  [ThemeAlign.LEFT]: { label: "Left" },
  [ThemeAlign.CENTER]: { label: "Centered" },
};

export const HEADER_STYLES: Record<HeaderStyle, { label: string }> = {
  [HeaderStyle.PLAIN]: { label: "Plain" },
  [HeaderStyle.BANNER]: { label: "Banner" },
};

export const SIDEBAR_STYLES: Record<SidebarStyle, { label: string }> = {
  [SidebarStyle.PLAIN]: { label: "Plain" },
  [SidebarStyle.TINTED]: { label: "Tinted" },
};

export const DATE_STYLES: Record<DateStyle, { label: string }> = {
  [DateStyle.INLINE]: { label: "Beside the title" },
  [DateStyle.TIMELINE]: { label: "Timeline" },
};

/**
 * Photo shapes (#224), with their size in page units in the header and in the
 * sidebar. The photo is cropped 3:4; the square shapes show its middle.
 */
export const PHOTO_SHAPES: Record<PhotoShape, { label: string; header: { width: number; height: number }; sidebar: { width: number; height: number } }> = {
  [PhotoShape.CIRCLE]: { label: "Circle", header: { width: 80, height: 80 }, sidebar: { width: 104, height: 104 } },
  [PhotoShape.ROUNDED]: { label: "Rounded square", header: { width: 80, height: 80 }, sidebar: { width: 104, height: 104 } },
  [PhotoShape.SQUARE]: { label: "Square", header: { width: 80, height: 80 }, sidebar: { width: 104, height: 104 } },
  [PhotoShape.PORTRAIT]: { label: "Portrait", header: { width: 72, height: 96 }, sidebar: { width: 96, height: 128 } },
};

export const PHOTO_POSITIONS: Record<PhotoPosition, { label: string }> = {
  [PhotoPosition.HEADER_END]: { label: "End of the header" },
  [PhotoPosition.HEADER_START]: { label: "Start of the header" },
  [PhotoPosition.ABOVE_NAME]: { label: "Above the name" },
  [PhotoPosition.SIDEBAR]: { label: "Top of the sidebar" },
};

/** The sidebar layout's column width and the gap next to it. */
export const SIDEBAR = { width: 150, gap: 28 };

/**
 * A theme font as documents use it. The script fonts come first (each only
 * covers its own script, set in document.module.css), then Greek in a matching
 * style, then the theme font, so every script prints with a bundled font.
 */
function documentFamily(font: ThemeFont): string {
  const { family, serif } = THEME_FONTS[font];
  return `var(--script-fonts), ${serif ? "var(--typeface-greek-serif)" : "var(--typeface-greek-sans)"}, ${family}`;
}

/**
 * A theme's settings resolved for rendering. `layout` overrides the theme's
 * own, e.g. a tailored resume in a single column (E5-1 decision).
 */
export function resolveTheme(theme: ThemeData, layout: ThemeLayout = theme.layout) {
  const split = hasSidebar(layout);
  const serifHeading = THEME_FONTS[theme.headFont].serif;
  return {
    /** A sidebar layout, the sidebar on either side. */
    split,
    sidebarEnd: layout === ThemeLayout.SPLIT_END,
    tintedSidebar: split && theme.sidebarStyle === SidebarStyle.TINTED,
    sideHeadings: layout === ThemeLayout.SIDE_HEADINGS,
    // Sidebar layouts always align the header left.
    centered: !split && theme.align === ThemeAlign.CENTER,
    banner: theme.headerStyle === HeaderStyle.BANNER,
    timeline: theme.dateStyle === DateStyle.TIMELINE,
    photo: {
      shape: theme.photoShape,
      // Only a sidebar layout has a sidebar to put it in.
      position: !split && theme.photoPosition === PhotoPosition.SIDEBAR ? PhotoPosition.HEADER_END : theme.photoPosition,
    },
    headFamily: documentFamily(theme.headFont),
    bodyFamily: documentFamily(theme.bodyFont),
    accent: theme.accent,
    /** Text on the accent, e.g. in a banner: white, or ink when that reads better. */
    onAccent: contrastRatio(theme.accent, "#ffffff") >= contrastRatio(theme.accent, INK) ? "#ffffff" : INK,
    heading: HEADING_STYLES[theme.headingStyle],
    density: DENSITIES[theme.density],
    name: serifHeading ? { size: 30, weight: 500 } : { size: 25, weight: 600 },
  };
}
export type ResolvedTheme = ReturnType<typeof resolveTheme>;

/** Millimetres for a length in page units on the given paper. */
export function unitsToMm(units: number, paper: PaperSize): number {
  return Math.round(((units * PAPER_SIZES[paper].widthMm) / PAGE_WIDTH) * 1000) / 1000;
}

/**
 * CSS for printing a document: the paper size, the theme's page padding as
 * page margins (so every page gets it, not just the first and last), and the
 * unit size for that paper. Rendered by the print route (E5-5).
 */
export function printCss(theme: ThemeData, paper: PaperSize): string {
  const { widthMm, heightMm } = PAPER_SIZES[paper];
  const { paddingY, paddingX } = DENSITIES[theme.density];
  return [
    `@page { size: ${widthMm}mm ${heightMm}mm; margin: ${unitsToMm(paddingY, paper)}mm ${unitsToMm(paddingX, paper)}mm; }`,
    `:root { --u: ${widthMm / PAGE_WIDTH}mm; }`,
    // White edge to edge, and the dev server's badge stays off the paper.
    "html, body { background: #fff; }",
    "@media print { nextjs-portal { display: none; } }",
  ].join("\n");
}
