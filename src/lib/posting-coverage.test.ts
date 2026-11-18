import { describe, expect, it } from "vitest";

import { byBestFit, coverageOf, coversFromScore, passes, type Coverage } from "./posting-coverage";

const requirement = (covered: boolean, mustHave = false) => ({ text: "x", mustHave, covered, evidence: null });
const fit = (...requirements: ReturnType<typeof requirement>[]) => ({ breakdown: { factors: [], cap: null, requirements } });

describe("posting coverage (E32-2)", () => {
  it("counts what's covered, in all, and the must-haves missing", () => {
    expect(coverageOf(fit(requirement(true, true), requirement(false, true), requirement(false)))).toEqual({ hit: 1, total: 3, mustMissing: 1 });
    expect(coverageOf(null)).toEqual({ hit: 0, total: 0, mustMissing: 0 });
    expect(coverageOf({ breakdown: null })).toEqual({ hit: 0, total: 0, mustMissing: 0 });
  });

  it("sorts by share, then fewer missing must-haves, then the newest; 0 of 0 last", () => {
    const row = (name: string, coverage: Coverage, at: number) => ({ name, coverage, at });
    const rows = [
      row("none", { hit: 0, total: 0, mustMissing: 0 }, 9),
      row("half, must missing", { hit: 2, total: 4, mustMissing: 1 }, 5),
      row("half, older", { hit: 1, total: 2, mustMissing: 0 }, 1),
      row("half, newer", { hit: 3, total: 6, mustMissing: 0 }, 4),
      row("all", { hit: 2, total: 2, mustMissing: 0 }, 0),
      row("nothing covered", { hit: 0, total: 3, mustMissing: 2 }, 8),
    ];
    expect(rows.toSorted(byBestFit).map((entry) => entry.name)).toEqual(["all", "half, newer", "half, older", "half, must missing", "nothing covered", "none"]);
  });

  it("passes a cut-off by share; 0 of 0 passes only Any", () => {
    expect(passes({ hit: 2, total: 3, mustMissing: 0 }, "two-thirds")).toBe(true);
    expect(passes({ hit: 1, total: 2, mustMissing: 0 }, "two-thirds")).toBe(false);
    expect(passes({ hit: 1, total: 2, mustMissing: 0 }, "half")).toBe(true);
    expect(passes({ hit: 3, total: 3, mustMissing: 0 }, "all")).toBe(true);
    expect(passes({ hit: 0, total: 0, mustMissing: 0 }, "half")).toBe(false);
    expect(passes({ hit: 0, total: 0, mustMissing: 0 }, "any")).toBe(true);
  });

  it("moves a saved 0–100 minimum over", () => {
    expect([40, 50, 65, 70, 85, 90, 100].map(coversFromScore)).toEqual(["any", "half", "half", "two-thirds", "two-thirds", "all", "all"]);
  });
});
