import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { arrangedSections, BUILT_IN_SECTIONS, DEFAULT_SECTION_LAYOUT, inSidebar, profileRows, sectionName, sectionOfUnit, sectionHeading, shownSections, withHeading, withMoved, withoutSectionsOff, withProfileRows } from "./resume-sections";

describe("arrangedSections", () => {
  it("keeps the order it's given", () => {
    const order = ["skills", "summary", "experience", "volunteering", "projects", "education", "certifications", "publications", "references", "languages"];
    expect(arrangedSections(order)).toEqual(order);
  });

  it("drops what no longer exists and repeats", () => {
    expect(arrangedSections(["gone", ...BUILT_IN_SECTIONS, "summary"])).toEqual([...BUILT_IN_SECTIONS]);
  });

  it("puts a section the list doesn't have after the one it usually follows", () => {
    const order = BUILT_IN_SECTIONS.filter((key) => key !== "certifications");
    expect(arrangedSections(["skills", ...order.filter((key) => key !== "skills")]).slice(0, 7)).toEqual([
      "skills",
      "summary",
      "experience",
      "volunteering",
      "projects",
      "education",
      "certifications",
    ]);
  });

  it("reads an empty list as the usual order", () => {
    expect(arrangedSections([])).toEqual([...BUILT_IN_SECTIONS]);
  });
});

describe("shownSections", () => {
  it("leaves out what's off and what has no content", () => {
    expect(shownSections({ order: ["skills", "summary", "experience"], off: ["summary"] }, ["skills", "summary", "languages"])).toEqual(["skills", "languages"]);
  });
});

describe("withMoved", () => {
  it("moves what's on screen and keeps the rest in their places", () => {
    // Volunteering is empty, so it isn't on screen: it stays third.
    const moved = withMoved(BUILT_IN_SECTIONS, ["projects", "summary", "experience"]);
    expect(moved.slice(0, 4)).toEqual(["projects", "summary", "volunteering", "experience"]);
  });
});

describe("a resume's own headings", () => {
  const layout = { order: [], off: [] };

  it("uses the usual heading until there's another", () => {
    expect(sectionHeading(layout, "experience", "Experience")).toBe("Experience");
    expect(sectionHeading(withHeading(layout, "experience", " Relevant experience "), "experience", "Experience")).toBe("Relevant experience");
  });

  it("goes back to the usual one when it's emptied, leaving the others", () => {
    const renamed = withHeading(withHeading(layout, "experience", "Work"), "skills", "Tools");
    const back = withHeading(renamed, "experience", "  ");
    expect(sectionHeading(back, "experience", "Experience")).toBe("Experience");
    expect(sectionHeading(back, "skills", "Skills")).toBe("Tools");
  });
});

describe("profileRows", () => {
  it("starts with Basics first and the Facts last, around the resume's order", () => {
    expect(profileRows(DEFAULT_SECTION_LAYOUT.order)).toEqual(["basics", ...BUILT_IN_SECTIONS, "facts"]);
  });

  it("follows the resume's order, with new custom sections above References", () => {
    const rows = profileRows(["skills", ...BUILT_IN_SECTIONS.filter((key) => key !== "skills")], ["custom:a"]);
    expect(rows.slice(0, 2)).toEqual(["basics", "skills"]);
    expect(rows.indexOf("custom:a")).toBe(rows.indexOf("references") - 1);
  });

  it("keeps Basics and the Facts where they were put", () => {
    const order = withProfileRows(DEFAULT_SECTION_LAYOUT.order, ["summary", "facts", ...BUILT_IN_SECTIONS.slice(1), "basics"]);
    expect(profileRows(order).slice(0, 2)).toEqual(["summary", "facts"]);
    expect(profileRows(order).at(-1)).toBe("basics");
  });
});

describe("withProfileRows", () => {
  const rows = (...first: string[]) => [...first, ...profileRows(DEFAULT_SECTION_LAYOUT.order).filter((key) => !first.includes(key))];

  it("doesn't change what a resume draws when only Basics or the Facts move", () => {
    const order = withProfileRows(DEFAULT_SECTION_LAYOUT.order, rows("facts"));
    expect(arrangedSections(order)).toContain("facts");
    expect(shownSections({ order, off: [] }, [...BUILT_IN_SECTIONS])).toEqual([...BUILT_IN_SECTIONS]);
  });

  it("moves a section on resumes too", () => {
    const order = withProfileRows(DEFAULT_SECTION_LAYOUT.order, rows("basics", "skills"));
    expect(shownSections({ order, off: [] }, [...BUILT_IN_SECTIONS])[0]).toBe("skills");
  });

  it("keeps a deleted custom section's place, for Undo", () => {
    const before = profileRows(DEFAULT_SECTION_LAYOUT.order, ["custom:gone"]);
    const order = withProfileRows(before, before.filter((key) => key !== "custom:gone").reverse());
    expect(order).toContain("custom:gone");
    expect(order.indexOf("custom:gone")).toBe(before.indexOf("custom:gone"));
  });

  it("survives a move on the base resume, which only knows its own sections", () => {
    const order = withProfileRows(DEFAULT_SECTION_LAYOUT.order, rows("facts"));
    const next = withMoved(order, ["experience", "summary"]);
    expect(next[0]).toBe("facts");
    expect(next.indexOf("experience")).toBeLessThan(next.indexOf("summary"));
  });
});

describe("sectionOfUnit", () => {
  const profile = demoProfile();
  const role = profile.experience[0];
  const volunteering = { ...profile, experience: [{ ...role, volunteering: true }] };

  it("knows a role from volunteering", () => {
    expect(sectionOfUnit(`experience:${role.id}`, { ...profile, experience: [{ ...role, volunteering: false }] })).toBe("experience");
    expect(sectionOfUnit(`experience:${role.id}`, volunteering)).toBe("volunteering");
  });

  it("knows the other parts, and no others", () => {
    expect(sectionOfUnit("summary", profile)).toBe("summary");
    expect(sectionOfUnit("project:p1", profile)).toBe("projects");
    expect(sectionOfUnit("education:e1", profile)).toBe("education");
    expect(sectionOfUnit("certification:c1", profile)).toBe("certifications");
    expect(sectionOfUnit("publication:u1", profile)).toBe("publications");
    expect(sectionOfUnit("paragraph:1", profile)).toBeNull();
  });
});

describe("withoutSectionsOff", () => {
  const profile = demoProfile();

  it("changes nothing by default", () => {
    expect(withoutSectionsOff(profile, DEFAULT_SECTION_LAYOUT)).toEqual(profile);
  });

  it("takes out what's off, but keeps skills and languages for the AI", () => {
    const seen = withoutSectionsOff(profile, { order: [], off: ["projects", "experience", "skills"] });
    expect(seen.projects).toEqual([]);
    expect(seen.experience.filter((entry) => !entry.volunteering)).toEqual([]);
    expect(seen.skills).toEqual(profile.skills);
  });
});

describe("custom sections (#298)", () => {
  const section = (id: string, format: "ENTRIES" | "LINES" | "INLINE" = "LINES") => ({ id, title: `Section ${id}`, format, countsAs: "EXTRA_ACTIVITIES" as const, items: [{ id: `${id}-1`, title: "One", subtitle: "", startYear: null, startMonth: null, endYear: null, endMonth: null, current: false, details: "", link: "", onResumes: true }] });

  it("puts a new one above References, in the order they're given", () => {
    const arranged = arrangedSections(BUILT_IN_SECTIONS, ["custom:a", "custom:b"]);
    expect(arranged.slice(arranged.indexOf("publications"), arranged.indexOf("skills"))).toEqual(["publications", "custom:a", "custom:b", "references"]);
  });

  it("keeps one where it was put, and drops one that's gone", () => {
    expect(arrangedSections(["custom:a", ...BUILT_IN_SECTIONS], ["custom:a"])[0]).toBe("custom:a");
    expect(arrangedSections(["custom:gone", ...BUILT_IN_SECTIONS], [])).not.toContain("custom:gone");
  });

  it("keeps one that's gone in the saved order, so Undo puts it back in its place", () => {
    const order = ["custom:gone", ...BUILT_IN_SECTIONS];
    expect(withMoved(order, ["experience", "summary"])[0]).toBe("custom:gone");
  });

  it("finds a part's section, whatever its format", () => {
    const profile = { ...demoProfile(), customSections: [section("a"), section("b")] };
    expect(sectionOfUnit("custom-entry:a-1", profile)).toBe("custom:a");
    expect(sectionOfUnit("custom-line:b-1", profile)).toBe("custom:b");
    expect(sectionOfUnit("custom-inline:b", profile)).toBe("custom:b");
    expect(sectionOfUnit("custom-line:gone", profile)).toBeNull();
  });

  it("keeps only inline ones in a sidebar", () => {
    const sections = [section("a", "INLINE"), section("b", "ENTRIES")];
    expect(inSidebar("skills", sections)).toBe(true);
    expect(inSidebar("custom:a", sections)).toBe(true);
    expect(inSidebar("custom:b", sections)).toBe(false);
    expect(inSidebar("experience", sections)).toBe(false);
  });

  it("names a section, and an unnamed one", () => {
    expect(sectionName("custom:a", [section("a")])).toBe("Section a");
    expect(sectionName("custom:a", [{ ...section("a"), title: " " }])).toBe("Untitled section");
    expect(sectionName("skills", [])).toBe("Skills");
  });

  it("leaves one that's off out of what the AI sees", () => {
    const profile = { ...demoProfile(), customSections: [section("a"), section("b")] };
    expect(withoutSectionsOff(profile, { order: [], off: ["custom:a"] }).customSections.map((entry) => entry.id)).toEqual(["b"]);
  });
});
