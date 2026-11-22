import { describe, expect, it } from "vitest";

import { isCountryName } from "./country-names";

describe("isCountryName (#371)", () => {
  it("knows countries in several languages and their usual short names", () => {
    for (const name of ["Netherlands", "the Netherlands", "Germany", "Deutschland", "España", "USA", "U.S.", "United Kingdom", "UK", "Côte d’Ivoire", "Iran"]) {
      expect(isCountryName(name), name).toBe(true);
    }
  });

  it("isn't fooled by a state, a region or a city", () => {
    for (const name of ["Oregon", "Bavaria", "Portland", "California", "Europe", "", "Unknown Region"]) {
      expect(isCountryName(name), name).toBe(false);
    }
  });
});
