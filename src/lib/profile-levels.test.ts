import { describe, expect, it } from "vitest";

import { levelRange, levelRangeLabel, levelRangeSchema, levelsIn } from "./profile-levels";

describe("a profile's levels (E24-3)", () => {
  it("is a range over the search's five steps, lower first", () => {
    expect(levelRange("lead", "senior")).toEqual({ from: "senior", to: "lead" });
    expect(levelRange("any", "senior")).toBeNull();
    expect(levelRange(null, null)).toBeNull();
    expect(levelRangeSchema.parse({ from: "mid", to: "intern" })).toEqual({ from: "intern", to: "mid" });
    expect(levelRangeSchema.safeParse({ from: "any", to: "mid" }).success).toBe(false);
  });

  it("reads as the search's labels, and takes in each step between", () => {
    expect(levelRangeLabel({ from: "senior", to: "lead" })).toBe("Senior to Lead or director");
    expect(levelRangeLabel({ from: "mid", to: "mid" })).toBe("Mid level");
    expect(levelsIn({ from: "junior", to: "senior" })).toEqual(["junior", "mid", "senior"]);
  });
});
