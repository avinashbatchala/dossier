import { describe, expect, it } from "vitest";

import { experienceLevelOf, fitsExperience, yearsAskedFor } from "./experience";

const posting = (title: string, description = "") => ({ title, description });

describe("the experience level of a posting (public issue 59)", () => {
  it("reads the title first", () => {
    expect(experienceLevelOf(posting("Product Design Intern"))).toBe("intern");
    expect(experienceLevelOf(posting("Werkstudent (m/w/d) Marketing"))).toBe("intern");
    expect(experienceLevelOf(posting("Junior Developer", "We ask for 8+ years of experience"))).toBe("junior");
    expect(experienceLevelOf(posting("Sr. Backend Engineer"))).toBe("senior");
    expect(experienceLevelOf(posting("Head of Design"))).toBe("lead");
    expect(experienceLevelOf(posting("Principal Engineer"))).toBe("lead");
    // A manager isn't a level, and "leading" isn't "lead".
    expect(experienceLevelOf(posting("Product Manager, leading our checkout team"))).toBeNull();
  });

  it("reads the years asked for when the title doesn't say", () => {
    expect(yearsAskedFor("You bring 5+ years of experience in design.")).toBe(5);
    expect(yearsAskedFor("3-5 years' experience with React; 10 years ago we started")).toBe(3);
    expect(yearsAskedFor("Mindestens 2 Jahre Berufserfahrung")).toBe(2);
    expect(yearsAskedFor("A 2-year warranty on every product. Founded 12 years ago.")).toBeNull();
    expect(experienceLevelOf(posting("Designer", "at least 1 year of experience"))).toBe("junior");
    expect(experienceLevelOf(posting("Designer", "3+ years of experience"))).toBe("mid");
    expect(experienceLevelOf(posting("Designer", "7 years experience required"))).toBe("senior");
    expect(experienceLevelOf(posting("Designer", "A great team."))).toBeNull();
  });

  it("keeps a posting for the level asked for, or one that doesn't say, and all of them without a level", () => {
    const senior = posting("Senior Designer");
    const intern = posting("Design Intern");
    const unsaid = posting("Designer", "Join us.");
    expect([senior, intern, unsaid].filter((entry) => fitsExperience(entry, { experience: "senior" }))).toEqual([senior, unsaid]);
    expect([senior, intern, unsaid].filter((entry) => fitsExperience(entry, { experience: "intern" }))).toEqual([intern, unsaid]);
    expect([senior, intern, unsaid].filter((entry) => fitsExperience(entry, { experience: "any" }))).toHaveLength(3);
    expect([senior, intern, unsaid].filter((entry) => fitsExperience(entry, {}))).toHaveLength(3);
    // A range (E24-6) keeps every level in it.
    const mid = posting("Designer", "3+ years of experience");
    expect([senior, intern, unsaid, mid].filter((entry) => fitsExperience(entry, { experience: "mid", experienceTo: "senior" }))).toEqual([senior, unsaid, mid]);
  });
});
