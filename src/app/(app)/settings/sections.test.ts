import { describe, expect, it } from "vitest";

import { settingsSectionFromParam, settingsSectionHref } from "./sections";

describe("settings sections", () => {
  it("reads the section from the URL, defaulting to AI provider", () => {
    expect(settingsSectionFromParam("data")).toBe("data");
    expect(settingsSectionFromParam(undefined)).toBe("ai");
    expect(settingsSectionFromParam("nope")).toBe("ai");
    expect(settingsSectionFromParam(["about", "data"])).toBe("ai");
    // The MCP connector's old name (#281).
    expect(settingsSectionFromParam("claude")).toBe("connector");
  });

  it("links to a section", () => {
    expect(settingsSectionHref("documents")).toBe("/settings?section=documents");
  });
});
