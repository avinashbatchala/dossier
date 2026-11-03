/** The settings sections, in order (PRD §6.8). */
export const SETTINGS_SECTIONS = [
  { id: "ai", label: "AI provider" },
  { id: "jobs", label: "Job search" },
  { id: "scoring", label: "Scoring" },
  { id: "agent", label: "Job agent" },
  { id: "documents", label: "Documents" },
  { id: "google", label: "Google" },
  { id: "connector", label: "MCP connector" },
  { id: "data", label: "Your data" },
  { id: "about", label: "About" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/** The section in `?section=`, or AI provider when it's missing or unknown; "claude" is the MCP connector's old name (#281). */
export function settingsSectionFromParam(value: string | string[] | undefined): SettingsSectionId {
  if (value === "claude") return "connector";
  return SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? "ai";
}

export const settingsSectionHref = (id: SettingsSectionId) => `/settings?section=${id}`;
