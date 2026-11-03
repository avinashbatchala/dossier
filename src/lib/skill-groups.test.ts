import { describe, expect, it } from "vitest";

import { inEditorOrder, skillGroups, skillLine, skillNamesIn, skillsText } from "./skill-groups";

const skill = (name: string, group = "") => ({ name, group });
const skills = [skill("GEO", "AI search"), skill("Figma"), skill("Crawl budget", "Technical SEO"), skill("AEO", "AI search"), skill("HTML & CSS"), skill("Log analysis", " Technical SEO ")];

describe("skill groups (#280)", () => {
  it("groups skills where each group's first skill is, without a group as the group \"\"", () => {
    expect(skillGroups(skills).map(({ group, skills: members }) => [group, members.map(({ name }) => name)])).toEqual([
      ["AI search", ["GEO", "AEO"]],
      ["", ["Figma", "HTML & CSS"]],
      ["Technical SEO", ["Crawl budget", "Log analysis"]],
    ]);
  });

  it("puts skills without a group first, as Profile → Skills shows them", () => {
    expect(inEditorOrder(skills).map(({ name }) => name)).toEqual(["Figma", "HTML & CSS", "GEO", "AEO", "Crawl budget", "Log analysis"]);
  });

  it("writes a line per group, led by its name, and one without a label for the rest", () => {
    expect(skillsText(inEditorOrder(skills))).toBe("Figma · HTML & CSS\nAI search: GEO · AEO\nTechnical SEO: Crawl budget · Log analysis");
    expect(skillsText([skill("Figma"), skill("Prototyping")])).toBe("Figma · Prototyping");
    expect(skillsText([])).toBe("");
  });

  it("reads a line's label, and the skill names without the labels", () => {
    expect(skillLine("AI search: GEO · AEO")).toEqual({ label: "AI search", text: "GEO · AEO" });
    expect(skillLine("Figma · HTML & CSS")).toEqual({ label: null, text: "Figma · HTML & CSS" });
    expect(skillNamesIn("Figma · HTML & CSS\nAI search: GEO · AEO\n\n Technical SEO: Crawl budget ")).toEqual(["Figma", "HTML & CSS", "GEO", "AEO", "Crawl budget"]);
    expect(skillNamesIn("")).toEqual([]);
  });
});
