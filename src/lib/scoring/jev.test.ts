import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import { jevState, scoreWithJev, SCORE_POSTING_JEV_VERSION } from "./jev";
import type { Answer } from "./typesafe";

const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
const posting = {
  title: "Senior Product Designer",
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "€75,000–€90,000",
  description: "Ledgerly makes accounting software.\n\n- 5+ years of product design\n- Dutch is a plus",
};

const score = (value: number): Answer => ({ type: "score", score: value, confidence: 0.8, probabilities: {} });
const noul = (value: number): Answer => ({ type: "noul", noul: value });
const choice = (value: string): Answer => ({ type: "choice", choice: value, confidence: 0.8, probabilities: {} });

const answers: Record<string, Answer> = {
  line0Kind: choice("other"),
  line0Covered: noul(0.1),
  line1Kind: choice("must"),
  line1Covered: noul(0.95),
  line2Kind: choice("nice"),
  line2Covered: noul(0.9),
  work: score(3),
  extra: score(2),
  education: score(2),
  seniority: choice("fits"),
  location: choice("fits"),
  thin: noul(0.05),
};

describe("jevState (#274, E25-1)", () => {
  it("cuts a posting longer than the AI model would get", () => {
    expect(jevState({ ...posting, description: ` ${"a".repeat(25_000)} ` }, profile).posting.text).toHaveLength(20_000);
  });
});

describe("scoreWithJev", () => {
  it("asks Jev the engine's questions in one request and names the version that answered", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: "jev-1.15.0", answers, usage: { input_tokens: 1800 } }));
    const onUsage = vi.fn();
    const result = await scoreWithJev(posting, profile, { key: "ts", fetchImpl, onUsage, baseUrl: "https://typesafe.test" });
    expect(result.scoredWith).toBe(`${SCORE_POSTING_JEV_VERSION} (jev-1.15.0)`);
    expect(result.answers.requirements).toEqual([
      { text: "5+ years of product design", mustHave: true, covered: true, evidence: null },
      { text: "Dutch is a plus", mustHave: false, covered: true, evidence: null },
    ]);
    expect(result.answers.seniority).toEqual({ fit: "fits", reason: "The role's level is within the levels this profile is for." });

    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { state: { candidate: { seniority: { levels: string } } }; questions: Record<string, unknown> };
    expect(Object.keys(body.questions)).toHaveLength(12);
    expect(body.state.candidate.seniority.levels).toBe("Senior to Lead or director");
    // TypeSafe reports the input only (#290).
    expect(onUsage).toHaveBeenCalledWith({ task: "score-posting-jev", provider: "JEV", model: "jev-1.15.0", input: 1800, output: null });
  });

  it("fails clearly on an answer it can't trust", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ model: "jev-1.15.0", answers: { ...answers, seniority: choice("senior") } }));
    await expect(scoreWithJev(posting, profile, { key: "ts", fetchImpl, baseUrl: "https://typesafe.test" })).rejects.toThrow("TypeSafe's answer didn't come back in the expected shape. Try again.");
  });
});
