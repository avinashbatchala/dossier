import { describe, expect, it } from "vitest";

import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsSectionFromParam, settingsSectionHref } from "./sections";

describe("settings sections", () => {
  it("reads the section from the URL, opening the overview without one (ST1)", () => {
    expect(settingsSectionFromParam("data")).toBe("data");
    expect(settingsSectionFromParam("ai")).toBe("ai");
    expect(settingsSectionFromParam(undefined)).toBe("overview");
    expect(settingsSectionFromParam("nope")).toBe("overview");
    expect(settingsSectionFromParam(["about", "data"])).toBe("overview");
    // The MCP connector's old name (#281).
    expect(settingsSectionFromParam("claude")).toBe("connector");
  });

  it("links to a section, and to the overview", () => {
    expect(settingsSectionHref("documents")).toBe("/settings?section=documents");
    expect(settingsSectionHref("overview")).toBe("/settings");
  });

  it("groups every section once, in the sections' order (E34)", () => {
    expect(SETTINGS_GROUPS.flatMap((group) => group.sections)).toEqual(SETTINGS_SECTIONS.map((section) => section.id));
  });
});
