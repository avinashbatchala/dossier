import { describe, expect, it } from "vitest";

import { addUp, capLine, factorText, fitLines, requirementsValue, type FactorAnswers, type RequirementAnswer } from "./factors";

const must = (text: string, covered = true): RequirementAnswer => ({ text, mustHave: true, covered, evidence: covered ? "Senior Designer at Acme" : null });
const nice = (text: string, covered = true): RequirementAnswer => ({ text, mustHave: false, covered, evidence: null });

/** Every factor at its top unless `change` says otherwise. */
const answers = (change: Partial<FactorAnswers> = {}): FactorAnswers => ({
  requirements: [must("5+ years of product design"), must("Figma"), nice("Dutch")],
  work: { value: 1, reason: "You've done this work." },
  extra: { value: 1, reason: "Your projects show it." },
  education: { value: 1, reason: "Your degree meets it." },
  seniority: { fit: "fits", reason: "Within your levels." },
  location: { fit: "fits", reason: "Amsterdam is home." },
  thin: false,
  ...change,
});

describe("addUp (E25-1)", () => {
  it("gives everything its weight: 35 requirements, 25 work, 15 seniority, 10 location, 10 education, 5 extra", () => {
    const { score, breakdown } = addUp(answers());
    expect(score).toBe(100);
    expect(breakdown.factors.map((line) => [line.factor, line.points, line.max])).toEqual([
      ["requirements", 35, 35],
      ["work", 25, 25],
      ["seniority", 15, 15],
      ["location", 10, 10],
      ["education", 10, 10],
      ["extra", 5, 5],
    ]);
    expect(breakdown.cap).toBeNull();

    // A step off in level and a stretch to get there are half; the levels in between are shares.
    expect(addUp(answers({ seniority: { fit: "above", reason: "" }, location: { fit: "stretch", reason: "" }, work: { value: 2 / 3, reason: "" } })).score).toBe(79);
  });

  it("counts a must-have three times a nice-to-have, and a posting with only nice-to-haves by them alone", () => {
    expect(requirementsValue([must("a"), must("b"), must("c"), must("d"), nice("e"), nice("f"), nice("g", false), nice("h", false)])).toBeCloseTo(14 / 16);
    expect(requirementsValue([nice("a"), nice("b", false)])).toBe(0.5);
    expect(requirementsValue([])).toBeNull();
  });

  it("leaves Requirements out when the posting lists none, and the other factors make up the score", () => {
    const { score, breakdown } = addUp(answers({ requirements: [], work: { value: 0.5, reason: "" } }));
    expect(score).toBe(Math.round(((65 - 12.5) / 65) * 100));
    expect(breakdown.factors[0]).toEqual({ factor: "requirements", points: 0, max: 0, reason: "Not counted: the posting lists no requirements, so the other factors make up the score." });
  });

  it("says how many must-haves and nice-to-haves the profile shows", () => {
    expect(addUp(answers({ requirements: [must("a"), must("b", false), nice("c")] })).breakdown.factors[0].reason).toBe("You show 1 of 2 must-haves and 1 of 1 nice-to-have.");
    expect(addUp(answers({ requirements: [must("a")] })).breakdown.factors[0].reason).toBe("You show 1 of 1 must-have.");
  });

  it("caps one missing must-have at 69 and two or more at 49, naming them", () => {
    const one = addUp(answers({ requirements: [must("Kubernetes", false), ...Array.from({ length: 9 }, (_, index) => must(`skill ${index}`))] }));
    expect(one.score).toBe(69);
    expect(one.breakdown.cap).toEqual({ at: 69, reason: "“Kubernetes” is a must-have you don't show." });
    expect(capLine(one.breakdown.cap!)).toBe("Capped at 69: “Kubernetes” is a must-have you don't show.");

    const four = addUp(answers({ requirements: ["Go", "AWS", "Kafka", "Rust"].map((text) => must(text, false)).concat(Array.from({ length: 30 }, (_, index) => must(`s${index}`))) }));
    expect(four.score).toBe(49);
    expect(four.breakdown.cap?.reason).toBe("4 must-haves you don't show: “Go”, “AWS” and “Kafka” and more.");
  });

  it("caps a large seniority gap either way at 69, a place the profile can't work at 49 and a thin posting at 60", () => {
    expect(addUp(answers({ seniority: { fit: "far-above", reason: "" } })).breakdown.cap).toEqual({ at: 69, reason: "The role is far above the levels this profile is for." });
    expect(addUp(answers({ seniority: { fit: "far-below", reason: "" } })).score).toBe(69);
    expect(addUp(answers({ location: { fit: "cannot", reason: "" } })).breakdown.cap).toEqual({ at: 49, reason: "The job is somewhere this profile can't work." });
    expect(addUp(answers({ thin: true })).breakdown.cap).toEqual({ at: 60, reason: "The posting says too little to judge." });
    // The lowest cap holds.
    expect(addUp(answers({ thin: true, location: { fit: "cannot", reason: "" } })).score).toBe(49);
  });

  it("names a cap only when it held the score down", () => {
    const low = addUp(answers({ thin: true, work: { value: 0, reason: "" }, education: { value: 0, reason: "" }, requirements: [must("a", false), must("b", false)] }));
    expect(low.score).toBeLessThan(49);
    expect(low.breakdown.cap).toBeNull();
  });
});

describe("the breakdown as lines", () => {
  it("gives each factor's points and reason, and the cap and missing must-haves as red flags", () => {
    const { breakdown } = addUp(answers({ requirements: [must("Kubernetes", false), must("Figma")] }));
    expect(factorText(breakdown.factors[0])).toBe("Requirements 18/35: You show 1 of 2 must-haves.");
    expect(fitLines(breakdown)).toEqual({
      reasons: breakdown.factors.map(factorText),
      redFlags: ["Capped at 69: “Kubernetes” is a must-have you don't show.", "Missing: Kubernetes"],
    });
  });
});
