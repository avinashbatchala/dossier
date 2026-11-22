import { z } from "zod";

import { DEFAULT_SECTION_LAYOUT, sectionLayoutSchema } from "@/lib/resume-sections";
import { DEFAULT_BASE_THEME, flag, json } from "@/lib/settings";

// Each profile's own settings (E24-1, #402): its Base resume and the order of
// its entries on the Profile page. They were global settings before E24, and
// are kept the same way, as text by key, in the profile's `settings` column.

const profileSettingsSchema = z.object({
  /** The Base resume's theme. loadProfileSettings() reads a deleted one as Editorial. */
  baseThemeId: z.string().catch(DEFAULT_BASE_THEME),
  /** The Base resume's language, for its headings and dates; null means English, with the direction read from the profile. */
  resumeLanguage: z.string().nullable().catch(null),
  /** The Base resume's sections: their order, which are off, and the headings it renames (#297, #339). */
  resumeSections: json(sectionLayoutSchema).catch(DEFAULT_SECTION_LAYOUT),
  /** "Fit to one page" on the Base resume (public issue 69): spacing, then type, tightened until it fits. */
  fitBaseResume: flag(false),
  /** Skills (public issue 62): the most relevant first on tailored resumes, until the user sets their own order, which is then kept. */
  skillOrder: z.enum(["relevance", "manual"]).catch("relevance"),
  /** Experience, projects and education: newest first by date, or the order set by hand (E4-9). */
  experienceOrder: z.enum(["date", "manual"]).catch("date"),
  projectOrder: z.enum(["date", "manual"]).catch("date"),
  educationOrder: z.enum(["date", "manual"]).catch("date"),
  /** "I don't have this" on what employers ask for (E33-3): the skills' keys (skillKey). */
  gapsDismissed: json(z.array(z.string())).catch([]),
  /** "Not here" on a role's gap prompt (E33-4): "{role id} {skill key}". */
  gapsNotHere: json(z.array(z.string())).catch([]),
});
export type ProfileSettings = z.output<typeof profileSettingsSchema>;

/** The keys, which were Setting keys before E24 (the migration moved them). */
export const PROFILE_SETTING_KEYS = Object.keys(profileSettingsSchema.shape) as (keyof ProfileSettings)[];

/** A profile's settings from its `settings` column; what's missing or doesn't fit reads as the default. */
export function profileSettingsFrom(stored: unknown): ProfileSettings {
  const values = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return profileSettingsSchema.parse(Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string")));
}

/** The stored text for each change: JSON for an object, null to forget a value. */
export function profileSettingValues(current: unknown, changes: Partial<ProfileSettings>): Record<string, string> {
  const values: Record<string, string> = {};
  if (current && typeof current === "object" && !Array.isArray(current)) {
    for (const [key, value] of Object.entries(current)) if (typeof value === "string") values[key] = value;
  }
  for (const [key, change] of Object.entries(changes)) {
    if (change === undefined) continue;
    if (change === null) delete values[key];
    else values[key] = typeof change === "object" ? JSON.stringify(change) : String(change);
  }
  return values;
}
