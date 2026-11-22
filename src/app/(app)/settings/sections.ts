/** The settings sections (PRD §6.8), in the order of their groups (E34). */
export const SETTINGS_SECTIONS = [
  { id: "ai", label: "AI provider" },
  { id: "documents", label: "Documents" },
  { id: "scoring", label: "Scoring" },
  { id: "jobs", label: "Job search" },
  { id: "agent", label: "Job agent" },
  { id: "google", label: "Google" },
  { id: "notifications", label: "Notifications" },
  { id: "connector", label: "MCP connector" },
  { id: "data", label: "Data and backups" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** A section, or the overview of them all (E34-2). */
export type SettingsPage = SettingsSectionId | "overview";

/** The overview's groups, and the section list's (E34-2, E34-3). */
export const SETTINGS_GROUPS: readonly { label: string; sections: readonly SettingsSectionId[] }[] = [
  { label: "Writing", sections: ["ai", "documents", "scoring"] },
  { label: "Finding work", sections: ["jobs", "agent"] },
  { label: "Connected", sections: ["google", "notifications", "connector"] },
  { label: "Your data · About", sections: ["data", "about"] },
];

export const settingsLabel = (id: SettingsSectionId) => SETTINGS_SECTIONS.find((section) => section.id === id)!.label;

/**
 * The section in `?section=`, or the overview when it's missing or unknown
 * (ST1); "claude" is the MCP connector's old name (#281).
 */
export function settingsSectionFromParam(value: string | string[] | undefined): SettingsPage {
  if (value === "claude") return "connector";
  return SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? "overview";
}

export const settingsSectionHref = (id: SettingsPage) => (id === "overview" ? "/settings" : `/settings?section=${id}`);
