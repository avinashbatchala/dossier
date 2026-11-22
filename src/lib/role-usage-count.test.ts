import { describe, expect, it } from "vitest";

import { countRoleUsage, roleLinesNote, roleUsageLabel } from "./role-usage-count";

const resume = (...ids: string[]) => ({ units: ids.map((id) => ({ id, label: "", text: "" })) });

describe("role usage (E33-2)", () => {
  it("counts each role once per tailored resume, from its units", () => {
    const usage = countRoleUsage([
      resume("summary", "experience:a", "experience:b", "skills"),
      resume("experience:a", "experience:a", "project:a"),
      resume("summary"),
      { units: null },
      { units: [null, 3, { id: 7 }, { id: "experience:c" }] },
    ]);
    expect(usage).toEqual({ resumes: 5, roles: { a: 2, b: 1, c: 1 } });
  });

  it("says how many resumes use a role, and nothing before the first one", () => {
    const usage = countRoleUsage([resume("experience:a"), resume("experience:a"), resume("summary")]);
    expect(roleUsageLabel(usage, "a")).toBe("Used in 2 of 3 resumes");
    expect(roleUsageLabel(usage, "b")).toBe("Not used in a resume yet");
    expect(roleUsageLabel(countRoleUsage([resume("experience:a")]), "a")).toBe("Used in 1 of 1 resume");
    expect(roleUsageLabel(countRoleUsage([]), "a")).toBeNull();
  });

  it("notes a closed role's lines and how many resumes use it", () => {
    const usage = countRoleUsage([resume("experience:a"), resume("summary")]);
    expect(roleLinesNote(usage, "a", "Led it\n\n  \nShipped it")).toBe("2 lines · used in 1 resume");
    expect(roleLinesNote(usage, "b", "Led it")).toBe("1 line · not used in a resume yet");
    expect(roleLinesNote(countRoleUsage([]), "a", "Led it\nShipped it\nRan it")).toBe("3 lines");
  });
});
