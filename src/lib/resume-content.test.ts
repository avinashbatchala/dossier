import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";

import { contactItems, displayLink, resumeContent } from "./resume-content";

const today = new Date(2026, 8, 28);

describe("contactItems", () => {
  const { basics } = demoProfile();

  it("lists email, phone, city and country, website and LinkedIn", () => {
    expect(contactItems(basics, today)).toEqual([
      "jane.doe@example.com",
      "+31 6 1234 5678",
      "Rotterdam, Netherlands",
      "example.com",
      "linkedin.com/in/janedoe-example",
    ]);
  });

  it("adds the age only when show-age is on", () => {
    expect(contactItems({ ...basics, showAge: true }, today).at(-1)).toBe("Age 34");
    expect(contactItems({ ...basics, showAge: true, dob: "" }, today)).toHaveLength(5);
  });

  it("skips what's empty", () => {
    expect(contactItems({ ...basics, phone: " ", city: "", website: "" }, today)).toEqual([
      "jane.doe@example.com",
      "Netherlands",
      "linkedin.com/in/janedoe-example",
    ]);
  });
});

describe("resumeContent", () => {
  const profile = demoProfile();

  it("builds the base resume from the profile", () => {
    const content = resumeContent(profile, { today });
    expect(content.name).toBe("Jane Doe");
    expect(content.experience.map((role) => [role.company, role.dates])).toEqual([
      ["Northwind Logistics", "Mar 2021 – Present"],
      ["Fieldnote", "Jun 2018 – Feb 2021"],
      ["Studio Brik", "Sep 2015 – May 2018"],
    ]);
    expect(content.experience[0].bullets).toHaveLength(3);
    expect(content.experience[2].skills).toEqual(["HTML & CSS", "Interaction design"]);
    expect(content.education[0]).toMatchObject({ dates: "2013 – 2015", notes: "Thesis on trust in automated scheduling tools" });
    expect(content.skills).toBe(
      "Interaction design · Design systems · Prototyping · User research · Figma · HTML & CSS · Workshop facilitation",
    );
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("includes references only when asked", () => {
    expect(resumeContent(profile).references).toEqual([]);
    expect(resumeContent(profile, { includeReferences: true }).references[0]).toEqual({
      id: "r1",
      name: "John Doe",
      role: "Former manager, Northwind Logistics",
      contact: "john.doe@example.com",
    });
  });

  it("leaves an empty profile empty, apart from a placeholder name", () => {
    const empty: ProfileData = {
      basics: { ...profile.basics, ...Object.fromEntries(Object.keys(profile.basics).map((key) => [key, ""])), showAge: false },
      skills: [],
      languages: [],
      experience: [],
      projects: [],
      education: [],
      references: [],
    };
    expect(resumeContent(empty)).toEqual({
      name: "Your name",
      headline: "",
      contacts: [],
      summary: "",
      experience: [],
      projects: [],
      education: [],
      skills: "",
      languages: "",
      references: [],
    });
  });

  it("takes a tailored resume's text from its units", () => {
    const content = resumeContent(profile, { units: demoResumeUnits() });
    expect(content.summary).toMatch(/^Senior product designer with nine years of making complex/);
    expect(content.experience[0].bullets[0]).toBe(
      "Led the redesign of the carrier portal used daily by 4,000+ dispatchers: a dense, high-stakes workflow",
    );
    // Role skills still come from the profile (RES-6).
    expect(content.experience[0].skills).toContain("Design systems");
    expect(content.skills).toMatch(/^Design systems · User research · Figma · /);
    expect(content.languages).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("lays out projects like roles, with their link as a resume shows it (PRO-13)", () => {
    expect(resumeContent(profile).projects).toEqual([
      {
        id: "p1",
        name: "Tidewater design tokens",
        link: "github.com/janedoe/tidewater",
        dates: "Jan 2023 – Present",
        bullets: profile.projects[0].bullets.split("\n"),
        skills: ["Design systems", "Figma", "HTML & CSS"],
      },
    ]);
    expect(displayLink("https://www.example.com/work/")).toBe("example.com/work");
    expect(displayLink(" http://github.com/jane ")).toBe("github.com/jane");
    // A tailored resume takes a project's bullets from its unit, and leaves out one without a unit.
    const tailored = resumeContent(profile, { units: [{ id: "project:p1", label: "Tidewater project", text: "Shipped a token pipeline" }] });
    expect(tailored.projects.map((project) => project.bullets)).toEqual([["Shipped a token pipeline"]]);
    expect(resumeContent(profile, { units: [] }).projects).toEqual([]);
  });

  it("includes only the parts a tailored resume has units for, in their order", () => {
    const units = [
      { id: "experience:e2", label: "Fieldnote role", text: "Ran research" },
      { id: "experience:e1", label: "Northwind Logistics role", text: "Led the portal redesign" },
      { id: "experience:gone", label: "Deleted role", text: "Ignored" },
      { id: "education:d1", label: "MSc", text: "" },
    ];
    const content = resumeContent(profile, { units });
    expect(content.summary).toBe("");
    expect(content.experience.map((role) => [role.company, role.bullets])).toEqual([
      ["Fieldnote", ["Ran research"]],
      ["Northwind Logistics", ["Led the portal redesign"]],
    ]);
    expect(content.education.map((entry) => entry.school)).toEqual(["TU Delft"]);
    expect(content.skills).toBe("");
    expect(content.languages).toBe("");
  });
});
