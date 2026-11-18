import { describe, expect, it } from "vitest";

import { changedLines } from "./changed-lines";

describe("changedLines (E30-12, AP4)", () => {
  it("picks the new lines of a role, as they read on the page", () => {
    expect(changedLines("Led the portal\nRan research", "Led the portal\n- Built the design system across six teams\nRan research")).toEqual(["Built the design system across six teams"]);
  });

  it("marks the line that moved up when nothing else changed", () => {
    expect(changedLines("Led the portal\nBuilt the design system", "Built the design system\nLed the portal")).toEqual(["Built the design system"]);
  });

  it("marks the whole unit when it's one line, or all of it changed", () => {
    expect(changedLines("A calm designer.", "A designer of calm tools.")).toBeNull();
    expect(changedLines("One\nTwo", "Three\nFour")).toBeNull();
  });
});
