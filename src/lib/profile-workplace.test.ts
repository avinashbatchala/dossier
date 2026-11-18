import { describe, expect, it } from "vitest";

import { DEFAULT_WORKPLACE, placesFrom, workplaceFrom, workplaceSchema } from "./profile-workplace";

describe("where a profile wants to work (E24-4)", () => {
  it("starts on-site and hybrid within 50 km of the city, remote in the country, not moving", () => {
    expect(DEFAULT_WORKPLACE).toEqual({ modes: ["ONSITE", "HYBRID", "REMOTE"], radiusKm: 50, otherPlaces: [], remoteOpenTo: "country", remoteCountries: [], relocate: false, relocatePlaces: [] });
    expect(workplaceFrom(null)).toEqual(DEFAULT_WORKPLACE);
    expect(workplaceFrom({ modes: [] })).toEqual(DEFAULT_WORKPLACE);
  });

  it("takes the search's radius choices and at least one way of working", () => {
    const answers = { ...DEFAULT_WORKPLACE, modes: ["REMOTE"], remoteOpenTo: "countries", remoteCountries: ["de", "nl"] };
    expect(workplaceSchema.parse(answers)).toEqual(answers);
    expect(workplaceSchema.safeParse({ ...DEFAULT_WORKPLACE, radiusKm: 30 }).success).toBe(false);
    expect(workplaceSchema.safeParse({ ...DEFAULT_WORKPLACE, modes: [] }).error?.issues[0].message).toBe("Choose at least one way of working.");
  });

  it("reads places one a line, each once", () => {
    expect(placesFrom(" Berlin \n\nNetherlands\nBerlin; Vienna")).toEqual(["Berlin", "Netherlands", "Vienna"]);
  });
});
