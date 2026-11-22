"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { prisma } from "@/lib/prisma";
import { loadProfileSettings, saveProfileSettings } from "@/lib/profiles";
import { DEFAULT_BASE_THEME } from "@/lib/settings";
import { THEME_FIELDS } from "@/lib/theme-data";
import { sectionLayoutSchema } from "@/lib/resume-sections";
import { parseThemeFile, themeFieldsSchema } from "@/lib/theme-file";
import type { ThemeData } from "@/lib/themes";

const THEME_GONE = "That theme doesn't exist anymore. Reload the page to see your themes.";

// Each profile has its own Base resume (E24-1): these say which profile's.
const profileId = z.string().min(1);

/** The profile asked for, when it still exists (another tab may have deleted it). */
async function ownProfile(id: string): Promise<string> {
  if (!(await prisma.profile.count({ where: { id } }))) throw new ActionError("That profile no longer exists. Reload the page.");
  return id;
}

/** Makes a theme the base resume theme (RES-2). */
export const setBaseTheme = action(z.object({ profileId, id: z.string().min(1) }), async ({ profileId, id }) => {
  const theme = await prisma.theme.findUnique({ where: { id }, select: { id: true } });
  if (!theme) throw new ActionError(THEME_GONE);
  await saveProfileSettings(await ownProfile(profileId), { baseThemeId: id });
  revalidatePath("/resume");
  return null;
});

/** The base resume's order, from Profile or the Sections tab (#297), and which sections are on resumes. */
export const saveResumeSections = action(sectionLayoutSchema.extend({ profileId }), async ({ profileId, ...resumeSections }) => {
  await saveProfileSettings(await ownProfile(profileId), { resumeSections });
  revalidatePath("/resume");
  revalidatePath("/profile");
  return null;
});

/** The Base resume's language (E24-2), for its headings and dates: one of the built-in languages, or null for English. */
export const setBaseResumeLanguage = action(
  z.object({
    profileId,
    language: z
      .string()
      .refine((name) => DOCUMENT_LANGUAGES.some((language) => language.name === name), "Pick a language from the list.")
      .nullable(),
  }),
  async ({ profileId, language }) => {
    await saveProfileSettings(await ownProfile(profileId), { resumeLanguage: language });
    revalidatePath("/resume");
    return null;
  },
);

/** "Fit to one page" (public issue 69): saved at once; the preview and the PDF squeeze the resume until it fits. */
export const setFitBaseResume = action(z.object({ profileId, fit: z.boolean() }), async ({ profileId, fit }) => {
  await saveProfileSettings(await ownProfile(profileId), { fitBaseResume: fit });
  revalidatePath("/resume");
  return null;
});

/**
 * Saves the theme builder's draft (RES-3, RES-4) and makes it the base
 * theme: a new custom theme without an id, or an existing custom theme
 * edited in place. Built-in themes can't be changed.
 */
export const saveTheme = action(
  themeFieldsSchema.extend({ profileId, id: z.string().min(1).nullable() }),
  async ({ profileId, id, ...fields }, { toast }): Promise<ThemeData> => {
    await ownProfile(profileId);
    const theme = await prisma.$transaction(async (tx) => {
      let saved: ThemeData;
      if (id) {
        const existing = await tx.theme.findUnique({ where: { id }, select: { builtIn: true } });
        if (!existing) throw new ActionError(THEME_GONE);
        if (existing.builtIn) throw new ActionError("Built-in themes can't be changed. Save it as a new theme instead.");
        saved = await tx.theme.update({ where: { id }, data: fields, select: THEME_FIELDS });
      } else {
        saved = await tx.theme.create({ data: fields, select: THEME_FIELDS });
      }
      await saveProfileSettings(profileId, { baseThemeId: saved.id }, tx);
      return saved;
    });
    toast(`Saved “${theme.name}”. It's now your base resume theme.`);
    revalidatePath("/resume");
    return theme;
  },
);

// ─── Managing themes (E5-7, RES-8) ───────────────────────────────────────────

/** A copy of any theme, built-in or custom, as a new custom theme; it becomes the base theme. */
export const duplicateTheme = action(z.object({ profileId, id: z.string().min(1) }), async ({ profileId, id }, { toast }): Promise<ThemeData> => {
  await ownProfile(profileId);
  const original = await prisma.theme.findUnique({ where: { id }, select: { ...THEME_FIELDS, id: false, builtIn: false } });
  if (!original) throw new ActionError(THEME_GONE);
  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.theme.create({ data: { ...original, name: `${original.name} copy`.slice(0, 60) }, select: THEME_FIELDS });
    await saveProfileSettings(profileId, { baseThemeId: created.id }, tx);
    return created;
  });
  toast(`Made “${copy.name}”. It's now your base resume theme.`);
  revalidatePath("/resume");
  return copy;
});

/**
 * Deletes a custom theme. Documents that used it render in the base theme
 * from then on (the database drops the link); a profile whose Base resume
 * used it reads Editorial instead (loadProfileSettings). Answers with the
 * open profile's base theme after.
 */
export const deleteTheme = action(z.object({ profileId, id: z.string().min(1) }), async ({ profileId, id }, { toast }) => {
  const theme = await prisma.theme.findUnique({ where: { id }, select: { name: true, builtIn: true } });
  if (!theme) throw new ActionError(THEME_GONE);
  if (theme.builtIn) throw new ActionError("Built-in themes can't be deleted.");
  const { baseThemeId: current } = await loadProfileSettings(await ownProfile(profileId));
  const baseThemeId = await prisma.$transaction(async (tx) => {
    let base = current;
    if (base === id) {
      base = DEFAULT_BASE_THEME;
      await saveProfileSettings(profileId, { baseThemeId: base }, tx);
    }
    await tx.theme.delete({ where: { id } });
    return base;
  });
  toast(`Deleted “${theme.name}”.`);
  revalidatePath("/resume");
  return { baseThemeId };
});

/** A theme from an exported theme file, checked again here; it becomes the base theme. */
export const importTheme = action(z.object({ profileId, file: z.unknown() }), async ({ profileId, file }, { toast }): Promise<ThemeData> => {
  const read = parseThemeFile(file);
  if (!read.ok) throw new ActionError(read.error);
  await ownProfile(profileId);
  const theme = await prisma.$transaction(async (tx) => {
    const created = await tx.theme.create({ data: read.theme, select: THEME_FIELDS });
    await saveProfileSettings(profileId, { baseThemeId: created.id }, tx);
    return created;
  });
  toast(`Imported “${theme.name}”. It's now your base resume theme.`);
  revalidatePath("/resume");
  return theme;
});

