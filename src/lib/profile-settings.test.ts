import { describe, expect, it } from "vitest";

import { profileSettingsFrom, profileSettingValues } from "./profile-settings";
import { DEFAULT_SECTION_LAYOUT } from "./resume-sections";

describe("a profile's own settings (E24-1)", () => {
  it("reads nothing stored as the defaults the global settings had", () => {
    expect(profileSettingsFrom({})).toEqual({
      baseThemeId: "editorial",
      resumeLanguage: null,
      resumeSections: DEFAULT_SECTION_LAYOUT,
      fitBaseResume: false,
      skillOrder: "relevance",
      experienceOrder: "date",
      projectOrder: "date",
      educationOrder: "date",
      gapsDismissed: [],
      gapsNotHere: [],
    });
    expect(profileSettingsFrom(null)).toEqual(profileSettingsFrom({}));
  });

  it("reads what's stored as text, as the Setting table held it, and ignores what doesn't fit", () => {
    const stored = { baseThemeId: "custom-1", fitBaseResume: "true", resumeSections: '{"order":["skills"],"off":["references"]}', skillOrder: "sideways", other: 3 };
    expect(profileSettingsFrom(stored)).toMatchObject({ baseThemeId: "custom-1", fitBaseResume: true, resumeSections: { order: ["skills"], off: ["references"] }, skillOrder: "relevance" });
  });

  it("stores changes as text over what's there, and forgets a null", () => {
    expect(profileSettingValues({ baseThemeId: "custom-1", resumeLanguage: "German" }, { fitBaseResume: true, resumeLanguage: null, resumeSections: { order: ["skills"], off: [] } })).toEqual({
      baseThemeId: "custom-1",
      fitBaseResume: "true",
      resumeSections: '{"order":["skills"],"off":[]}',
    });
  });
});
