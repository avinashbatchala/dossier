import { describe, expect, it } from "vitest";

import { startupAddress, startupFilterFromParams, startupFilterHref, startupFilterSchema } from "./types";

describe("the Startups screen's filter in its address (#222)", () => {
  it("reads the filter, with defaults for what's missing or wrong", () => {
    expect(startupFilterFromParams({})).toEqual(startupFilterSchema.parse({}));
    expect(startupFilterFromParams({ q: ["android", "x"], place: "remote", source: "yc", email: "1", view: "saved", sort: "newest" })).toEqual({
      q: "android",
      place: "remote",
      source: "YC",
      withEmail: true,
      view: "SAVED",
      sort: "newest",
    });
    expect(startupFilterFromParams({ place: "mars" })).toEqual(startupFilterSchema.parse({}));
    // Hiring now by default; Contacted from before is Applied for (PL1).
    expect(startupFilterFromParams({}).view).toBe("HIRING");
    expect(startupFilterFromParams({ view: "contacted" }).view).toBe("APPLIED");
  });

  it("writes it back, leaving out the defaults", () => {
    expect(startupFilterHref(startupFilterSchema.parse({}))).toBe("/startups");
    // The country is the default, so it stays out of the address; "any" does not.
    const filter = startupFilterSchema.parse({ q: "fintech", place: "country", source: "HN", withEmail: true, view: "DISMISSED", sort: "newest" });
    expect(startupFilterHref(filter)).toBe("/startups?q=fintech&source=hn&email=1&view=dismissed&sort=newest");
    expect(startupFilterFromParams(Object.fromEntries(new URL(`https://x${startupFilterHref(filter)}`).searchParams))).toEqual(filter);
    // Anywhere in the world isn't the default, so it stays in the address.
    const anywhere = startupFilterSchema.parse({ place: "any" });
    expect(startupFilterHref(anywhere)).toBe("/startups?place=any");
    expect(startupFilterFromParams({ place: "any" })).toEqual(anywhere);
  });

  it("looks anywhere when the profile has no country", () => {
    expect(startupFilterFromParams({}, { defaultPlace: "any" }).place).toBe("any");
    expect(startupFilterHref(startupFilterSchema.parse({ place: "any" }), { defaultPlace: "any" })).toBe("/startups");
    expect(startupFilterFromParams({ place: "mars" }, { defaultPlace: "any" }).place).toBe("any");
  });
});

describe("the address for a startup's application (#222)", () => {
  const entry = (email: string, label: string) => ({ email, label, from: "", onRequest: false, foundAt: "" });

  it("prefers the application address, then the founders', a general one, and someone's own", () => {
    expect(startupAddress([entry("jane@a.io", "Person"), entry("hi@a.io", "General"), entry("founders@a.io", "Founders"), entry("jobs@a.io", "Hiring")])).toBe("jobs@a.io");
    expect(startupAddress([entry("jane@a.io", "Person"), entry("hi@a.io", "General")])).toBe("hi@a.io");
  });

  it("has none without addresses, or when they can't be read", () => {
    expect(startupAddress(null)).toBe("");
    expect(startupAddress([])).toBe("");
    expect(startupAddress("not a list")).toBe("");
  });
});
