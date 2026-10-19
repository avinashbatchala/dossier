/** The settings sections, in order (PRD §6.8). */
export const SETTINGS_SECTIONS = [
  { id: "ai", label: "AI provider" },
  { id: "jobs", label: "Job search" },
  { id: "agent", label: "Job agent" },
  { id: "documents", label: "Documents" },
  { id: "google", label: "Google" },
  { id: "data", label: "Your data" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** The section in `?section=`, or AI provider when it's missing or unknown. */
export function settingsSectionFromParam(value: string | string[] | undefined): SettingsSectionId {
  return SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? "ai";
}

export const settingsSectionHref = (id: SettingsSectionId) => `/settings?section=${id}`;
