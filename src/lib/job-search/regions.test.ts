import { describe, expect, it } from "vitest";

import { workableFrom } from "./regions";

describe("workableFrom", () => {
  it("keeps a posting that says anywhere, or nothing it recognises", () => {
    for (const place of ["", "Worldwide", "Anywhere in the World", "Remote", "Any State", "UTC-5 to UTC+3", "USA, Worldwide"]) expect(workableFrom(place, "de"), place).toBe(true);
  });

  it("keeps a posting that names the country, in any of its names", () => {
    expect(workableFrom("Berlin, Germany", "de")).toBe(true);
    expect(workableFrom("München, Deutschland", "de")).toBe(true);
    expect(workableFrom("Canada,  UK,  USA", "gb")).toBe(true);
    expect(workableFrom("Remote - USA", "us")).toBe(true);
    expect(workableFrom("Your Remote US Home Office", "us")).toBe(true);
    expect(workableFrom("Russian Federation, Rwanda", "ru")).toBe(true);
  });

  it("keeps a posting for a region the country is in", () => {
    expect(workableFrom("Europe", "de")).toBe(true);
    expect(workableFrom("EMEA", "ke")).toBe(true);
    expect(workableFrom("LATAM, Europe, USA, Canada, APAC", "br")).toBe(true);
    expect(workableFrom("DACH", "at")).toBe(true);
    expect(workableFrom("North America", "ca")).toBe(true);
  });

  it("drops a posting that names only other places", () => {
    expect(workableFrom("USA only", "de")).toBe(false);
    expect(workableFrom("Berlin, Germany", "us")).toBe(false);
    expect(workableFrom("LATAM", "de")).toBe(false);
    expect(workableFrom("Tokyo, Japan", "fr")).toBe(false);
    expect(workableFrom("Dallas, Texas", "gb")).toBe(false);
  });

  it("reads a longer name before a shorter one inside it", () => {
    expect(workableFrom("Latin America", "us")).toBe(false);
    expect(workableFrom("Albuquerque, New Mexico", "mx")).toBe(false);
    expect(workableFrom("Albuquerque, New Mexico", "us")).toBe(true);
    expect(workableFrom("Belfast, Northern Ireland", "ie")).toBe(false);
  });

  it("reads a US state's or a Canadian province's code, and one that's a country's code too counts as both", () => {
    expect(workableFrom("San Francisco, CA", "us")).toBe(true);
    expect(workableFrom("New York, NY (HQ)", "de")).toBe(false);
    expect(workableFrom("Toronto, ON", "ca")).toBe(true);
    expect(workableFrom("Berlin, DE", "de")).toBe(true);
    expect(workableFrom("SIHO - Columbus, IN", "in")).toBe(true);
  });

  it("keeps Georgia for both the country and the state", () => {
    expect(workableFrom("Atlanta, Georgia", "us")).toBe(true);
    expect(workableFrom("Tbilisi, Georgia", "ge")).toBe(true);
  });
});
