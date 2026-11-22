import localFont from "next/font/local";

// Every font ships with the app (PRD RES-7), so nothing is fetched from a font
// CDN and the app and its PDFs work offline. See README.md in this folder.
//
// Each font sets a --typeface-* variable on <html>; globals.css maps them to
// Tailwind's font-* utilities, and the resume themes use them directly.
//
// Static faces, one file per weight, never variable fonts: Chromium's PDF
// printer can't embed a variable font and draws its glyphs as Type 3
// outlines instead, which other viewers and parsers read wrongly (public
// issues 64 and 67). Documents use 400 to 700; the UI's lighter weights fall
// back to 400.

/** UI text. */
const geist = localFont({
  src: [
    { path: "./geist/Geist-Regular.woff2", weight: "400" },
    { path: "./geist/Geist-Medium.woff2", weight: "500" },
    { path: "./geist/Geist-SemiBold.woff2", weight: "600" },
    { path: "./geist/Geist-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-geist",
  fallback: ["Helvetica", "Arial", "sans-serif"],
});

/** Page and section titles; also a resume theme font. */
const newsreader = localFont({
  src: [
    { path: "./newsreader/Newsreader-Regular.woff2", weight: "400" },
    { path: "./newsreader/Newsreader-Medium.woff2", weight: "500" },
    { path: "./newsreader/Newsreader-SemiBold.woff2", weight: "600" },
    { path: "./newsreader/Newsreader-Bold.woff2", weight: "700" },
    { path: "./newsreader/Newsreader-Italic.woff2", weight: "400", style: "italic" },
    { path: "./newsreader/Newsreader-MediumItalic.woff2", weight: "500", style: "italic" },
    { path: "./newsreader/Newsreader-SemiBoldItalic.woff2", weight: "600", style: "italic" },
    { path: "./newsreader/Newsreader-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
  variable: "--typeface-newsreader",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
});

// The remaining fonts are only used on some screens (code-like values, resume
// themes), so they load when a page uses them instead of being preloaded.

const plexSans = localFont({
  src: [
    { path: "./ibm-plex-sans/IBMPlexSans-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans/IBMPlexSans-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans/IBMPlexSans-SemiBold.woff2", weight: "600" },
    { path: "./ibm-plex-sans/IBMPlexSans-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-plex-sans",
  fallback: ["Helvetica", "Arial", "sans-serif"],
  preload: false,
});

const plexMono = localFont({
  src: [
    { path: "./ibm-plex-mono/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./ibm-plex-mono/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
    // Headings ask for 600: a real face, so Chromium doesn't embolden one (Type 3 again).
    { path: "./ibm-plex-mono/IBMPlexMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
  variable: "--typeface-plex-mono",
  fallback: ["ui-monospace", "monospace"],
  adjustFontFallback: false,
  preload: false,
});

const ebGaramond = localFont({
  src: [
    { path: "./eb-garamond/EBGaramond-Regular.woff2", weight: "400" },
    { path: "./eb-garamond/EBGaramond-Medium.woff2", weight: "500" },
    { path: "./eb-garamond/EBGaramond-SemiBold.woff2", weight: "600" },
    { path: "./eb-garamond/EBGaramond-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-eb-garamond",
  fallback: ["Garamond", "Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

// More resume theme fonts: serifs, then sans, then mono.

const sourceSerif = localFont({
  src: [
    { path: "./source-serif-4/SourceSerif4-Regular.woff2", weight: "400" },
    { path: "./source-serif-4/SourceSerif4-Medium.woff2", weight: "500" },
    { path: "./source-serif-4/SourceSerif4-SemiBold.woff2", weight: "600" },
    { path: "./source-serif-4/SourceSerif4-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-source-serif",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

const lora = localFont({
  src: [
    { path: "./lora/Lora-Regular.woff2", weight: "400" },
    { path: "./lora/Lora-Medium.woff2", weight: "500" },
    { path: "./lora/Lora-SemiBold.woff2", weight: "600" },
    { path: "./lora/Lora-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-lora",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

const libreCaslon = localFont({
  src: [
    { path: "./libre-caslon-text/LibreCaslonText-Regular.woff2", weight: "400" },
    { path: "./libre-caslon-text/LibreCaslonText-Medium.woff2", weight: "500" },
    { path: "./libre-caslon-text/LibreCaslonText-SemiBold.woff2", weight: "600" },
    { path: "./libre-caslon-text/LibreCaslonText-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-libre-caslon",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

const playfair = localFont({
  src: [
    { path: "./playfair-display/PlayfairDisplay-Regular.woff2", weight: "400" },
    { path: "./playfair-display/PlayfairDisplay-Medium.woff2", weight: "500" },
    { path: "./playfair-display/PlayfairDisplay-SemiBold.woff2", weight: "600" },
    { path: "./playfair-display/PlayfairDisplay-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-playfair",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

const fraunces = localFont({
  src: [
    { path: "./fraunces/Fraunces-Regular.woff2", weight: "400" },
    { path: "./fraunces/Fraunces-Medium.woff2", weight: "500" },
    { path: "./fraunces/Fraunces-SemiBold.woff2", weight: "600" },
    { path: "./fraunces/Fraunces-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-fraunces",
  fallback: ["Georgia", "serif"],
  adjustFontFallback: "Times New Roman",
  preload: false,
});

const inter = localFont({
  src: [
    { path: "./inter/Inter-Regular.woff2", weight: "400" },
    { path: "./inter/Inter-Medium.woff2", weight: "500" },
    { path: "./inter/Inter-SemiBold.woff2", weight: "600" },
    { path: "./inter/Inter-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-inter",
  fallback: ["Helvetica", "Arial", "sans-serif"],
  preload: false,
});

const manrope = localFont({
  src: [
    { path: "./manrope/Manrope-Regular.woff2", weight: "400" },
    { path: "./manrope/Manrope-Medium.woff2", weight: "500" },
    { path: "./manrope/Manrope-SemiBold.woff2", weight: "600" },
    { path: "./manrope/Manrope-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-manrope",
  fallback: ["Helvetica", "Arial", "sans-serif"],
  preload: false,
});

const workSans = localFont({
  src: [
    { path: "./work-sans/WorkSans-Regular.woff2", weight: "400" },
    { path: "./work-sans/WorkSans-Medium.woff2", weight: "500" },
    { path: "./work-sans/WorkSans-SemiBold.woff2", weight: "600" },
    { path: "./work-sans/WorkSans-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-work-sans",
  fallback: ["Helvetica", "Arial", "sans-serif"],
  preload: false,
});

const spaceGrotesk = localFont({
  src: [
    { path: "./space-grotesk/SpaceGrotesk-Regular.woff2", weight: "400" },
    { path: "./space-grotesk/SpaceGrotesk-Medium.woff2", weight: "500" },
    { path: "./space-grotesk/SpaceGrotesk-SemiBold.woff2", weight: "600" },
    { path: "./space-grotesk/SpaceGrotesk-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-space-grotesk",
  fallback: ["Helvetica", "Arial", "sans-serif"],
  preload: false,
});

const jetbrainsMono = localFont({
  src: [
    { path: "./jetbrains-mono/JetBrainsMono-Regular.woff2", weight: "400" },
    { path: "./jetbrains-mono/JetBrainsMono-Medium.woff2", weight: "500" },
    { path: "./jetbrains-mono/JetBrainsMono-SemiBold.woff2", weight: "600" },
    { path: "./jetbrains-mono/JetBrainsMono-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-jetbrains-mono",
  fallback: ["ui-monospace", "monospace"],
  adjustFontFallback: false,
  preload: false,
});

// Fallbacks for the scripts the theme fonts don't cover, so documents in
// Greek, Arabic, Persian, Hindi, Chinese, Japanese or Korean never depend on
// the fonts a system happens to have (E5-8). Each face only claims its own
// script's characters (unicode-range): documents list them before the theme
// font, Latin text skips them, and a browser downloads one only for text that
// needs it. Their variables name the face alone, without system fallbacks.
// (next/font only takes literal options, so the ranges are spelled out.)

/** Greek for serif themes: Newsreader has none, EB Garamond does. */
const greekSerif = localFont({
  src: [
    { path: "./eb-garamond/EBGaramond-Regular.woff2", weight: "400" },
    { path: "./eb-garamond/EBGaramond-Medium.woff2", weight: "500" },
    { path: "./eb-garamond/EBGaramond-SemiBold.woff2", weight: "600" },
    { path: "./eb-garamond/EBGaramond-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-greek-serif",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0370-03FF, U+1F00-1FFF" }],
});

/** Greek for sans and mono themes: Geist and Plex Mono have none, Plex Sans does. */
const greekSans = localFont({
  src: [
    { path: "./ibm-plex-sans/IBMPlexSans-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans/IBMPlexSans-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans/IBMPlexSans-SemiBold.woff2", weight: "600" },
    { path: "./ibm-plex-sans/IBMPlexSans-Bold.woff2", weight: "700" },
  ],
  variable: "--typeface-greek-sans",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0370-03FF, U+1F00-1FFF" }],
});

/** Arabic and Persian. */
const plexSansArabic = localFont({
  src: [
    { path: "./ibm-plex-sans-arabic/IBMPlexSansArabic-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans-arabic/IBMPlexSansArabic-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans-arabic/IBMPlexSansArabic-SemiBold.woff2", weight: "600" },
  ],
  variable: "--typeface-plex-sans-arabic",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0600-06FF, U+0750-077F, U+0870-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F" }],
});

/** Hindi. */
const plexSansDevanagari = localFont({
  src: [
    { path: "./ibm-plex-sans-devanagari/IBMPlexSansDevanagari-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans-devanagari/IBMPlexSansDevanagari-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans-devanagari/IBMPlexSansDevanagari-SemiBold.woff2", weight: "600" },
  ],
  variable: "--typeface-plex-sans-devanagari",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+0900-097F, U+1CD0-1CFF, U+A8E0-A8FF, U+200C-200D, U+20B9, U+25CC" }],
});

/** Japanese: kana and the JIS kanji. */
const plexSansJp = localFont({
  src: [
    { path: "./ibm-plex-sans-jp/IBMPlexSansJP-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans-jp/IBMPlexSansJP-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans-jp/IBMPlexSansJP-SemiBold.woff2", weight: "600" },
  ],
  variable: "--typeface-plex-sans-jp",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF, U+3040-30FF, U+31F0-31FF" }],
});

/** Korean: every Hangul syllable. */
const plexSansKr = localFont({
  src: [
    { path: "./ibm-plex-sans-kr/IBMPlexSansKR-Regular.woff2", weight: "400" },
    { path: "./ibm-plex-sans-kr/IBMPlexSansKR-Medium.woff2", weight: "500" },
    { path: "./ibm-plex-sans-kr/IBMPlexSansKR-SemiBold.woff2", weight: "600" },
  ],
  variable: "--typeface-plex-sans-kr",
  adjustFontFallback: false,
  preload: false,
  declarations: [
    { prop: "unicode-range", value: "U+1100-11FF, U+3000-303F, U+3130-318F, U+A960-A97F, U+AC00-D7AF, U+D7B0-D7FF, U+FF00-FFEF" },
  ],
});

/** Simplified Chinese: the GB 2312 characters, regular and semibold (see README.md). */
const notoSansSc = localFont({
  src: [
    { path: "./noto-sans-sc/NotoSansSC-Regular.woff2", weight: "400" },
    { path: "./noto-sans-sc/NotoSansSC-SemiBold.woff2", weight: "600" },
  ],
  variable: "--typeface-noto-sans-sc",
  adjustFontFallback: false,
  preload: false,
  declarations: [{ prop: "unicode-range", value: "U+3000-303F, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF" }],
});

/**
 * The dashboard's daily note (E27-1, #523): Caveat, hand-written. UI only,
 * never in a document, so it's a Latin subset and isn't preloaded (see README.md).
 */
const caveat = localFont({
  src: [{ path: "./caveat/Caveat-Medium.woff2", weight: "500" }],
  variable: "--typeface-caveat",
  fallback: ["cursive"],
  preload: false,
});

/** Class names that define every --typeface-* variable; set on <html>. */
export const fontVariables = [
  geist,
  newsreader,
  plexSans,
  plexMono,
  ebGaramond,
  sourceSerif,
  lora,
  libreCaslon,
  playfair,
  fraunces,
  inter,
  manrope,
  workSans,
  spaceGrotesk,
  jetbrainsMono,
  greekSerif,
  greekSans,
  plexSansArabic,
  plexSansDevanagari,
  plexSansJp,
  plexSansKr,
  notoSansSc,
  caveat,
]
  .map((font) => font.variable)
  .join(" ");
