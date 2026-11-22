import { describe, expect, it } from "vitest";

import { JOB_SOURCES } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import { ANYWHERE, PORTAL_GUIDES, portalsFor, startsTicked } from "./job-choices";

const portal = (id: (typeof JOB_SOURCES)[number], secret = false, consent: string | null = null) => ({
  id,
  countries: SOURCE_INFO[id].countries ? [...SOURCE_INFO[id].countries] : null,
  kinds: [...SOURCE_INFO[id].kinds],
  fields: secret ? [{ name: "key", label: "Key", type: "secret" as const, keyState: "none" as const, envName: null }] : [],
  consent,
});
const all = [portal("JSEARCH", true), portal("ADZUNA", true), portal("FREEHIRE"), portal("ARBEITSAGENTUR", false, "No official API.")];

describe("the setup guide's portals (E22-9)", () => {
  it("guides every built-in, linking only to https pages", () => {
    for (const id of JOB_SOURCES) expect(PORTAL_GUIDES[id].about, id).not.toBe("");
    for (const step of Object.values(PORTAL_GUIDES).flatMap((guide) => guide.steps)) if (step.link) expect(step.link.href).toMatch(/^https:\/\//);
  });

  it("lists the portals that cover where you look, and for remote anywhere those that cover every country", () => {
    expect(portalsFor(all, "de").map((entry) => entry.id)).toEqual(["JSEARCH", "ADZUNA", "FREEHIRE", "ARBEITSAGENTUR"]);
    expect(portalsFor(all, "se").map((entry) => entry.id)).toEqual(["JSEARCH", "FREEHIRE"]);
    expect(portalsFor(all, ANYWHERE).map((entry) => entry.id)).toEqual(["JSEARCH", "FREEHIRE"]);
  });

  it("starts ticked only what's free, needs no note, and is for the kind of work", () => {
    expect(all.filter((entry) => startsTicked(entry, "tech")).map((entry) => entry.id)).toEqual(["FREEHIRE"]);
    expect(all.filter((entry) => startsTicked(entry, "any")).map((entry) => entry.id)).toEqual([]);
  });
});
