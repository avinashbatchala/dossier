import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";

import { profileUpdate } from "./profile-update";
import type { ProfileData } from "./profile";

const live = demoProfile();
const units = demoResumeUnits();
const copyOf = (profile: ProfileData): Omit<ProfileData, "photo"> => {
  const copy: Partial<ProfileData> = { ...profile };
  delete copy.photo;
  return copy as Omit<ProfileData, "photo">;
};
const update = (changes: Partial<Parameters<typeof profileUpdate>[0]>) =>
  profileUpdate({ copy: copyOf(live), live, units, trimmed: null, language: "English", includeReferences: false, ...changes });
const line = (id: string, title: string) => ({ id, title, subtitle: "", startYear: null, startMonth: null, endYear: null, endMonth: null, current: false, details: "", link: "", onResumes: true });

describe("profileUpdate (#301)", () => {
  it("has nothing to do when the profile hasn't changed", () => {
    expect(update({}).changed).toBe(false);
    expect(update({ copy: null }).changed).toBe(false);
  });

  it("ignores a change resumes don't show, such as the order of a list", () => {
    expect(update({ live: { ...live, facts: [{ id: "f", text: "A new fact" }] } }).changed).toBe(false);
  });

  it("brings in a corrected title and contact details, and keeps the resume's own text", () => {
    const [role, ...rest] = live.experience;
    const changed = { ...live, basics: { ...live.basics, email: "new@example.com" }, experience: [{ ...role, role: "Head of Design", bullets: "From the profile" }, ...rest] };
    const result = update({ live: changed });
    expect(result.changed).toBe(true);
    expect(result.copy?.experience[0].role).toBe("Head of Design");
    expect(result.copy?.basics.email).toBe("new@example.com");
    expect(result.units).toEqual(units);
  });

  it("keeps an entry since deleted from the profile", () => {
    const [role, ...rest] = live.experience;
    const result = update({ live: { ...live, experience: rest } });
    expect(result.copy?.experience.map((entry) => entry.id)).toContain(role.id);
    expect(result.units).toEqual(units);
    expect(result.changed).toBe(false);
  });

  it("adds a new role to the section it holds, where the profile has it, in the profile's words", () => {
    const newest = { ...live.experience[0], id: "new-role", role: "Head of Design", company: "Acme", bullets: "Built the team" };
    const result = update({ live: { ...live, experience: [newest, ...live.experience] } });
    expect(result.changed).toBe(true);
    const ids = result.units.map((unit) => unit.id);
    expect(ids.indexOf("experience:new-role")).toBe(ids.indexOf(`experience:${live.experience[0].id}`) - 1);
    expect(result.units.find((unit) => unit.id === "experience:new-role")?.text).toBe("Built the team");
  });

  it("leaves out what was left out on purpose", () => {
    const [cut, ...kept] = units.filter((unit) => unit.id.startsWith("experience:"));
    const held = units.filter((unit) => unit.id !== cut.id);
    const result = update({ units: held, trimmed: [{ kind: "unit", unit: cut, index: 1 }] });
    expect(result.units.map((unit) => unit.id)).not.toContain(cut.id);
    expect(kept.length).toBeGreaterThan(0);
    expect(result.changed).toBe(false);
  });

  it("doesn't bring in a new section, which is for Add", () => {
    const withSection = { ...live, customSections: [{ id: "s1", title: "Awards", format: "LINES" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [line("i1", "Best Paper")] }] };
    const result = update({ live: withSection });
    expect(result.changed).toBe(false);
    expect(result.copy?.customSections).toEqual([]);
    expect(result.units).toEqual(units);
  });

  it("adds a new item to a custom section the resume holds, leaves its format alone, and joins inline items", () => {
    const sent = { id: "s1", title: "Awards", format: "LINES" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [line("i1", "Best Paper")] };
    const inline = { id: "s2", title: "Interests", format: "INLINE" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [line("i2", "Chess")] };
    const held = [...units, { id: "custom-line:i1", label: "Best Paper", text: "Best Paper, edited" }, { id: "custom-inline:s2", label: "Interests", text: "Chess" }];
    const now = {
      ...live,
      customSections: [
        { ...sent, format: "ENTRIES" as const, countsAs: "EXTRA_ACTIVITIES" as const, items: [...sent.items, line("i3", "Fellow")] },
        { ...inline, items: [...inline.items, line("i4", "Climbing")] },
      ],
    };
    const result = update({ copy: copyOf({ ...live, customSections: [sent, inline] }), live: now, units: held });
    expect(result.changed).toBe(true);
    expect(result.copy?.customSections[0].format).toBe("LINES");
    expect(result.units.find((unit) => unit.id === "custom-line:i1")?.text).toBe("Best Paper, edited");
    expect(result.units.find((unit) => unit.id === "custom-line:i3")?.text).toBe("Fellow");
    expect(result.units.some((unit) => unit.id.startsWith("custom-entry:"))).toBe(false);
    expect(result.units.find((unit) => unit.id === "custom-inline:s2")?.text).toBe("Chess\nClimbing");
  });

  it("gives a draft only the new items, since its details follow the profile already", () => {
    const newest = { ...live.projects[0], id: "new-project", name: "Tideline" };
    const result = update({ copy: null, live: { ...live, projects: [newest, ...live.projects] } });
    expect(result.copy).toBeNull();
    expect(result.changed).toBe(true);
    expect(result.units.map((unit) => unit.id)).toContain("project:new-project");
  });
});
