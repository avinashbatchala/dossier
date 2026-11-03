import { describe, expect, it, vi } from "vitest";

import { AiError } from "@/lib/ai/errors";
import { demoProfile } from "@/lib/demo-profile";

import { JEV_WEIGHTS, jevFit, jevParts, jevQuestions, jevScore, jevState, scoreWithJev, SCORE_POSTING_JEV_VERSION, type JevParts } from "./jev";
import type { Answer } from "./typesafe";

const profile = demoProfile();
const posting = {
  title: "Senior Product Designer",
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "€75,000–€90,000",
  description: "Ledgerly makes accounting software.\n\n- 5+ years of product design\n- Experience with a design system\n- Dutch is a plus",
};

const score = (value: number): Answer => ({ type: "score", score: value, confidence: 0.8, probabilities: {} });
const noul = (value: number): Answer => ({ type: "noul", noul: value });
const choice = (value: string): Answer => ({ type: "choice", choice: value, confidence: 0.8, probabilities: {} });

/** Answers to jevQuestions(lines): top levels and no mismatches unless `overrides` says otherwise. */
function answersFor(lines: { kind: string; shown: number }[], overrides: Record<string, Answer> = {}): Record<string, Answer> {
  return {
    requirements: score(4),
    work: score(3),
    seniority: score(3),
    place: noul(0.05),
    language: noul(0.05),
    thin: noul(0.05),
    ...Object.fromEntries(lines.flatMap((line, index) => [[`line${index}Kind`, choice(line.kind)], [`line${index}Shown`, noul(line.shown)]])),
    ...overrides,
  };
}

const parts = (overrides: Partial<JevParts> = {}): JevParts => ({ requirements: 1, work: 1, seniority: 1, place: 0, language: 0, thin: 0, lines: [], ...overrides });

describe("jevState (#274)", () => {
  it("sends the profile without the name, contact details or references, and the posting", () => {
    const state = jevState(posting, profile);
    const text = JSON.stringify(state);
    expect(state.posting).toEqual({ title: "Senior Product Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "€75,000–€90,000", text: posting.description });
    expect(state.candidate).not.toHaveProperty("name");
    expect(state.candidate).toHaveProperty("skills");
    expect(text).toContain("Northwind Logistics");
    for (const secret of [profile.basics.name, profile.basics.email, profile.basics.phone, "linkedin.com", ...profile.references.map((reference) => reference.name)]) {
      expect(text).not.toContain(secret);
    }
  });

  it("cuts a posting longer than the AI model would get", () => {
    expect(jevState({ ...posting, description: ` ${"a".repeat(25_000)} ` }, profile).posting.text).toHaveLength(20_000);
  });
});

describe("jevQuestions", () => {
  it("asks about the whole posting, then each line's kind and whether the profile shows it", () => {
    const questions = jevQuestions(["5+ years of product design", "Dutch is a plus"]);
    expect(Object.keys(questions)).toEqual(["requirements", "work", "seniority", "place", "language", "thin", "line0Kind", "line0Shown", "line1Kind", "line1Shown"]);
    expect(questions.requirements).toMatchObject({ type: "score", criteria: expect.arrayContaining([expect.stringMatching(/^Every core requirement/)]) });
    expect(questions.line1Kind).toMatchObject({ type: "choice", instructions: { line: "Dutch is a plus" } });
    expect(Object.keys((questions.line1Kind as { criteria: object }).criteria)).toEqual(["required", "preferred", "other"]);
    expect(questions.line0Shown).toMatchObject({ type: "noul", instructions: { line: "5+ years of product design" } });
  });
});

describe("jevParts", () => {
  it("reads each Score as 0 to 1 of its levels, and each line's kind and probability", () => {
    const lines = ["5+ years of product design", "Dutch is a plus"];
    const answers = answersFor([{ kind: "required", shown: 0.9 }, { kind: "something else", shown: 0.2 }], { requirements: score(3), work: score(1.5), seniority: score(7), thin: noul(1.4) });
    expect(jevParts(answers, lines)).toEqual({
      requirements: 0.75,
      work: 0.5,
      seniority: 1,
      place: 0.05,
      language: 0.05,
      thin: 1,
      lines: [
        { text: "5+ years of product design", kind: "required", shown: 0.9 },
        { text: "Dutch is a plus", kind: "other", shown: 0.2 },
      ],
    });
  });

  it("refuses answers with one missing or of the wrong kind", () => {
    const withoutWork = answersFor([]);
    delete withoutWork.work;
    for (const answers of [withoutWork, answersFor([], { place: score(1) }), answersFor([{ kind: "required", shown: 1 }], { line0Kind: noul(1) })]) {
      expect(() => jevParts(answers, ["5+ years of product design"])).toThrow(AiError);
    }
  });
});

describe("jevScore", () => {
  it("weighs the Scores: half the requirements, three tenths the past work, a fifth the level", () => {
    expect(jevScore(parts())).toBe(100);
    expect(jevScore(parts({ requirements: 0.5, work: 1, seniority: 1 }))).toBe(75);
    expect(jevScore(parts({ requirements: 0.5, work: 2 / 3, seniority: 2 / 3 }))).toBe(58);
    expect(jevScore(parts({ requirements: 0, work: 0, seniority: 0 }))).toBe(0);
    expect(jevScore(parts({ requirements: 1, work: 0, seniority: 0 }), { requirements: 1, work: 1, seniority: 2 })).toBe(25);
    expect(JEV_WEIGHTS).toEqual({ requirements: 0.5, work: 0.3, seniority: 0.2 });
  });

  it("takes 15 off for each mismatch, holds a thin posting at 60, and stays within 0 to 100", () => {
    expect(jevScore(parts({ place: 0.7 }))).toBe(85);
    expect(jevScore(parts({ place: 0.69, language: 0.9 }))).toBe(85);
    expect(jevScore(parts({ place: 0.9, language: 0.9 }))).toBe(70);
    expect(jevScore(parts({ thin: 0.8 }))).toBe(60);
    expect(jevScore(parts({ requirements: 0.1, work: 0, seniority: 0, place: 1, language: 1 }))).toBe(0);
  });
});

describe("jevFit", () => {
  const line = (text: string, kind: "required" | "preferred" | "other", shown: number) => ({ text, kind, shown });

  it("quotes the lines the profile covers, required ones first, and the required ones it misses", () => {
    const fit = jevFit(
      parts({
        work: 0.9,
        seniority: 0.5,
        lines: [
          line("Dutch is a plus", "preferred", 0.95),
          line("Ledgerly makes accounting software.", "other", 0.99),
          line("5+ years of product design", "required", 0.8),
          line("Experience with a design system", "required", 0.9),
          line("Figma prototypes", "required", 0.85),
          line("A degree in design", "required", 0.1),
          line("Fluent German", "required", 0.5),
        ],
      }),
    );
    expect(fit.reasons).toEqual([
      "Covers: Experience with a design system",
      "Covers: Figma prototypes",
      "Covers: 5+ years of product design",
      "Your past roles are close to this job's day-to-day work.",
    ]);
    expect(fit.redFlags).toEqual(["Missing: A degree in design"]);
  });

  it("says how much the profile covers when no line is, and that a thin posting is hard to judge", () => {
    expect(jevFit(parts({ requirements: 0.5, work: 0.5, seniority: 0.9 })).reasons).toEqual([
      "Your profile shows about half of what the posting asks for.",
      "The role's level matches your experience.",
    ]);
    expect(jevFit(parts({ requirements: 0, work: 0, seniority: 0.5, thin: 0.9 })).reasons).toEqual([
      "The posting says too little to judge the fit well.",
      "Little of what the posting asks for shows in your profile.",
    ]);
  });

  it("puts the mismatches first, and keeps to three red flags of quotes cut at a word", () => {
    const long = `Several years of ${"hands-on experience ".repeat(12)}`.trim();
    const fit = jevFit(
      parts({
        place: 0.8,
        language: 0.8,
        seniority: 0.1,
        lines: [line(long, "required", 0.1), line("Fluent German", "required", 0.2)],
      }),
    );
    expect(fit.redFlags).toEqual([
      "The posting asks for a location or work permit your profile doesn't show.",
      "The posting asks for a language your profile doesn't list at that level.",
      "The role's level is far from your experience.",
    ]);
    const missing = jevFit(parts({ lines: [line(long, "required", 0.1)] })).redFlags[0];
    expect(missing).toMatch(/^Missing: Several years of hands-on experience .*experience…$/);
    expect(missing.length).toBeLessThanOrEqual("Missing: ".length + 160);
  });
});

describe("scoreWithJev", () => {
  it("asks Jev once about the posting's lines and names the version that answered", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({
        model: "jev-1.14.0",
        answers: answersFor([
          { kind: "other", shown: 0.9 },
          { kind: "required", shown: 0.9 },
          { kind: "required", shown: 0.9 },
          { kind: "preferred", shown: 0.1 },
        ]),
      }),
    );
    const result = await scoreWithJev(posting, profile, { key: "ts-key", fetchImpl, baseUrl: "https://typesafe.test" });
    expect(result).toEqual({
      data: {
        score: 100,
        reasons: [
          "Covers: 5+ years of product design",
          "Covers: Experience with a design system",
          "Your past roles are close to this job's day-to-day work.",
          "The role's level matches your experience.",
        ],
        redFlags: [],
      },
      scoredWith: `${SCORE_POSTING_JEV_VERSION} (jev-1.14.0)`,
    });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { questions: Record<string, { instructions: { line?: string } }> };
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body.questions.line0Kind.instructions.line).toBe("Ledgerly makes accounting software.");
    expect(body.questions.line3Shown.instructions.line).toBe("Dutch is a plus");
  });
});
