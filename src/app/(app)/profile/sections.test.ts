import { describe, expect, it } from "vitest";

import { BUILT_IN_SECTIONS } from "@/lib/resume-sections";

import { navSections, SECTIONS, sectionFromParam, sectionHref } from "./sections";

describe("profile sections", () => {
  it("start in a resume's usual order, between Basics and Facts about me", () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(["basics", ...BUILT_IN_SECTIONS, "facts"]);
  });

  it("mark the ones that don't count towards Profile strength as optional (#216)", () => {
    expect(SECTIONS.filter((section) => section.optional).map((section) => section.id)).toEqual(["volunteering", "projects", "certifications", "publications", "references", "languages", "facts"]);
  });

  it("list in the order given, with a section the user made above References", () => {
    const section = { id: "a", title: "Awards", format: "LINES" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [] };
    const ids = navSections([section], ["facts", ...BUILT_IN_SECTIONS, "basics"]).map((entry) => entry.id);
    expect([ids[0], ids[1], ids.at(-1)]).toEqual(["facts", "summary", "basics"]);
    expect(ids.indexOf("custom:a")).toBe(ids.indexOf("references") - 1);
    expect(new Set(ids).size).toBe(SECTIONS.length + 1);
  });

  it("read the current section from the URL, falling back to Basics", () => {
    expect(sectionFromParam("experience")).toBe("experience");
    expect(sectionFromParam("facts")).toBe("facts");
    expect(sectionFromParam(undefined)).toBe("basics");
    expect(sectionFromParam("unknown")).toBe("basics");
    expect(sectionFromParam("new")).toBe("new");
    expect(sectionFromParam(["skills", "education"])).toBe("basics");
    expect(sectionHref("references")).toBe("/profile?section=references");
  });
});
