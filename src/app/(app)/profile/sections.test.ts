import { describe, expect, it } from "vitest";

import { SECTIONS, sectionFromParam, sectionHref } from "./sections";

describe("profile sections", () => {
  it("come in the order Basics → Skills & languages → Experience → Projects → Education → References", () => {
    expect(SECTIONS.map((section) => section.label)).toEqual([
      "Basics",
      "Skills & languages",
      "Experience",
      "Projects",
      "Education",
      "References",
    ]);
  });

  it("read the current section from the URL, falling back to Basics", () => {
    expect(sectionFromParam("experience")).toBe("experience");
    expect(sectionFromParam(undefined)).toBe("basics");
    expect(sectionFromParam("unknown")).toBe("basics");
    expect(sectionFromParam(["skills", "education"])).toBe("basics");
    expect(sectionHref("references")).toBe("/profile?section=references");
  });
});
