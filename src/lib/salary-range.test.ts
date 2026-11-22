import { describe, expect, it } from "vitest";

import { rangePosition, salaryAmounts } from "./salary-range";

describe("salaryAmounts (E30-7)", () => {
  it("reads amounts written out, with k, or with dots, and leaves small numbers out", () => {
    expect(salaryAmounts("€75,000–€90,000")).toEqual([75_000, 90_000]);
    expect(salaryAmounts("75k-90k, 27 days off")).toEqual([75_000, 90_000]);
    expect(salaryAmounts("€82.000 a year")).toEqual([82_000]);
    expect(salaryAmounts("Competitive")).toEqual([]);
  });
});

describe("rangePosition (E30-7)", () => {
  it("places the offer on the posted range", () => {
    expect(rangePosition("€75,000–€90,000", "€82,500")).toEqual({ low: 75_000, high: 90_000, amount: 82_500, at: 0.5 });
    expect(rangePosition("€75,000–€90,000", "€95,000")?.at).toBe(1);
    expect(rangePosition("Competitive", "€82,000")).toBeNull();
  });
});
