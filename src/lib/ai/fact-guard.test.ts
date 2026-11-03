import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import sample from "../../../prisma/seed/prototype-sample.json";

import { factSources, guardSources, guardUnits, sourcesFor, unverifiedFacts } from "./fact-guard";

const profile = demoProfile();
const extracted = {
  title: "Senior Product Designer · Ledgerly",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid · 3 days in office",
  salary: "€75,000–€90,000",
  deadline: "2026-10-15",
  requirements: [],
  asksForReferences: false,
  language: "English",
};
const sources = sourcesFor(profile, extracted, sample.ledgerly.posting, 11);
const check = (text: string) => unverifiedFacts(text, sources);

describe("the fact guard (E6-6)", () => {
  it("lets through what the profile says, however it's formatted", () => {
    expect(check("Led the redesign of a portal used by 4,000+ dispatchers")).toEqual([]);
    expect(check("Led the redesign of a portal used by 4000 dispatchers")).toEqual([]);
    expect(check("Grew the note-taking app to 120k users")).toEqual([]);
    expect(check("Designed the app to 120,000 users")).toEqual([]);
    expect(check("Product designer with nine years of experience")).toEqual([]);
    expect(check("Product designer with 9 years of experience")).toEqual([]);
    expect(check("Mentored three junior designers at Northwind Logistics since Mar 2021.")).toEqual([]);
  });

  it("flags numbers the profile doesn't back", () => {
    expect(check("Led a team of 12 designers")).toEqual(["12"]);
    expect(check("Cut support tickets by 30%")).toEqual(["30%"]);
    expect(check("Managed a budget of €2.5m")).toEqual(["2.5m"]);
  });

  it("flags employers, schools and tools that aren't in the profile or the posting", () => {
    expect(check("Before Northwind, I worked at Google and studied at Stanford.")).toEqual(["Google", "Stanford"]);
    expect(check("Built dashboards in Tableau and ran A/B tests in Optimizely")).toEqual(["Tableau", "Optimizely"]);
  });

  it("ignores capitals that start a sentence or a bullet, and months, and 'I'", () => {
    expect(check("Excited to apply. Happily, I'm based in Rotterdam.\n- Shipped the carrier portal in March")).toEqual([]);
  });

  it("knows the posting's own names and the years of experience the profile adds up to", () => {
    expect(check("I'd love to help Ledgerly's payments team in Amsterdam.")).toEqual([]);
    expect(check("Eleven years of design, 11 in total.")).toEqual([]);
    expect(check("Twenty years of design")).toEqual(["Twenty"]);
  });

  it("flags acronyms and credentials the profile doesn't have", () => {
    expect(check("An MBA and a certified scrum master")).toEqual(["MBA", "certified"]);
    expect(check("An MSc in Design for Interaction from TU Delft")).toEqual([]);
    expect(check("Knows WCAG 2.2 well")).toEqual([]);
  });

  it("flags years the profile doesn't have", () => {
    expect(check("Designing since 2015")).toEqual([]);
    expect(check("Designing since 2009")).toEqual(["2009"]);
  });

  it("takes the profile's facts and the application's as backing too (PRO-14, APP-15)", () => {
    const told = { ...profile, facts: [{ id: "f1", text: "I spent a year at Klarna before design school." }] };
    const claim = "A year at Klarna, and a talk at Config.";
    expect(unverifiedFacts(claim, sourcesFor(profile, extracted, sample.ledgerly.posting, 11))).toEqual(["Klarna", "Config"]);
    expect(unverifiedFacts(claim, sourcesFor(told, extracted, sample.ledgerly.posting, 11))).toEqual(["Config"]);
    expect(unverifiedFacts(claim, guardSources(told, extracted, sample.ledgerly.posting, ["I gave a talk at Config last year."]))).toEqual([]);
  });
});

describe("the fact guard on runaway output", () => {
  it("reads text ending in thousands of blank lines quickly", () => {
    const started = performance.now();
    expect(check(`Led the redesign at Northwind Logistics.${"\n".repeat(100_000)}`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("guardUnits", () => {
  it("notes what couldn't be backed on each unit, skipping units built from the profile", () => {
    const units = guardUnits(
      [
        { id: "summary", label: "Summary", text: "Led a team of 12 at Google." },
        { id: "experience:e1", label: "Northwind Logistics role", text: "Led the carrier portal redesign", unverified: ["old"] },
        { id: "skills", label: "Skills", text: "Kubernetes · Figma" },
      ],
      factSources(["Northwind Logistics", "Led the carrier portal redesign", "Figma"]),
    );
    expect(units).toEqual([
      { id: "summary", label: "Summary", text: "Led a team of 12 at Google.", unverified: ["Google", "12"] },
      { id: "experience:e1", label: "Northwind Logistics role", text: "Led the carrier portal redesign" },
      { id: "skills", label: "Skills", text: "Kubernetes · Figma" },
    ]);
  });
});
