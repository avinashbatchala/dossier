import { z } from "zod";

import {
  DateStyle,
  Density,
  HeaderStyle,
  HeadingStyle,
  PhotoPosition,
  PhotoShape,
  SidebarStyle,
  ThemeAlign,
  ThemeFont,
  ThemeLayout,
} from "@/generated/prisma/enums";

import { THEME_STYLE_DEFAULTS, type ThemeData } from "./themes";

// A theme as a file to share or keep (E5-7, RES-8), and the rules every saved
// theme's look follows, from the builder or a file.

export const THEME_FILE_FORMAT = "dossier-theme";
/**
 * Bump when the file's shape changes; imports refuse versions they don't
 * know. Version 2 added the header, sidebar and date styles, 3 the photo's
 * shape and position (#224); older files read with the defaults.
 */
export const THEME_FILE_VERSION = 3;

const font = z.enum(ThemeFont, { error: (issue) => `That theme uses a font Dossier doesn't have (${String(issue.input)}).` });

/** A theme's name and look, checked the same way wherever it comes from. */
export const themeFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .max(60, "Keep the name under 60 characters.")
    .transform((name) => name || "My theme"),
  headFont: font,
  bodyFont: font,
  accent: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "The accent has to be a color like #1f6f5c.")
    .transform((accent) => accent.toLowerCase()),
  layout: z.enum(ThemeLayout),
  align: z.enum(ThemeAlign),
  headingStyle: z.enum(HeadingStyle),
  density: z.enum(Density),
  headerStyle: z.enum(HeaderStyle),
  sidebarStyle: z.enum(SidebarStyle),
  dateStyle: z.enum(DateStyle),
  photoShape: z.enum(PhotoShape),
  photoPosition: z.enum(PhotoPosition),
});
export type ThemeFields = z.output<typeof themeFieldsSchema>;

export const themeFileSchema = z.object({
  format: z.literal(THEME_FILE_FORMAT),
  version: z.number(),
  // Version 1 files have no header, sidebar or date style, and versions 1 and 2 no photo.
  theme: themeFieldsSchema.extend({
    headerStyle: z.enum(HeaderStyle).default(THEME_STYLE_DEFAULTS.headerStyle),
    sidebarStyle: z.enum(SidebarStyle).default(THEME_STYLE_DEFAULTS.sidebarStyle),
    dateStyle: z.enum(DateStyle).default(THEME_STYLE_DEFAULTS.dateStyle),
    photoShape: z.enum(PhotoShape).default(THEME_STYLE_DEFAULTS.photoShape),
    photoPosition: z.enum(PhotoPosition).default(THEME_STYLE_DEFAULTS.photoPosition),
  }),
});

/** What an exported theme file holds. */
export function themeFile(theme: ThemeData) {
  const { name, headFont, bodyFont, accent, layout, align, headingStyle, density, headerStyle, sidebarStyle, dateStyle, photoShape, photoPosition } = theme;
  return {
    format: THEME_FILE_FORMAT,
    version: THEME_FILE_VERSION,
    theme: { name, headFont, bodyFont, accent, layout, align, headingStyle, density, headerStyle, sidebarStyle, dateStyle, photoShape, photoPosition },
  };
}

/** "Quiet green.dossier-theme.json": the name, without characters files can't have. */
export function themeFileName(theme: Pick<ThemeData, "name">): string {
  const name = theme.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() || "Theme";
  return `${name}.dossier-theme.json`;
}

/** A theme file's contents, checked, or why it can't be used, in plain words. */
export function parseThemeFile(json: unknown): { ok: true; theme: ThemeFields } | { ok: false; error: string } {
  const header = json as { format?: unknown; version?: unknown } | null;
  if (typeof json !== "object" || json === null || header?.format !== THEME_FILE_FORMAT) {
    return { ok: false, error: "That file isn't a Dossier theme." };
  }
  if (typeof header.version !== "number" || header.version > THEME_FILE_VERSION) {
    return { ok: false, error: "That theme comes from a newer version of Dossier. Update this server first." };
  }
  const parsed = themeFileSchema.safeParse(json);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    // The font message is written for people; others only say where the file is broken.
    return { ok: false, error: issue.message.startsWith("That") ? issue.message : `That theme file is damaged (${issue.path.join(".")}).` };
  }
  return { ok: true, theme: parsed.data.theme };
}
