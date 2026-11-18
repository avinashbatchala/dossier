import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import { askDecisions, decisionsAnswers, decisionsQuestions, DECISIONS_URL, scoreWithDecisions, SCORE_POSTING_DECISIONS_VERSION } from "./decisions";
import { engineQuestions } from "./questions";

const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
const posting = { title: "Senior Product Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "", description: "- 5+ years of product design\n- Dutch is a plus" };
const lines = ["5+ years of product design", "Dutch is a plus"];
const questions = engineQuestions(lines);

/** Decisions' answers to the engine's questions about `lines`, in order, as its API gives them. */
const answers = (change: Record<string, unknown> = {}) =>
  [
    { type: "choice", name: "line0Kind", choice: "must", confidence: 0.9, probabilities: [] },
    { type: "predicate", name: "line0Covered", probability: 0.95 },
    { type: "choice", name: "line1Kind", choice: "nice", confidence: 0.9, probabilities: [] },
    { type: "predicate", name: "line1Covered", probability: 0.2 },
    { type: "score", name: "work", score: 2.6, confidence: 0.7, probabilities: [] },
    { type: "score", name: "extra", score: 1, confidence: 0.7, probabilities: [] },
    { type: "score", name: "education", score: 2, confidence: 0.7, probabilities: [] },
    { type: "choice", name: "seniority", choice: "fits", confidence: 0.8, probabilities: [] },
    { type: "choice", name: "location", choice: "fits", confidence: 0.8, probabilities: [] },
    { type: "predicate", name: "thin", probability: 0.05 },
  ].map((answer) => (answer.name in change ? { ...answer, ...(change[answer.name] as object) } : answer));
const result = (list: unknown[] = answers()) => ({ model: "gpt-6-luna", answers: list, usage: { input_tokens: 2400, output_tokens: 0 } });

describe("decisionsQuestions (E25-3)", () => {
  it("asks the engine's questions as predicates, choices and scores, each named", () => {
    const asked = decisionsQuestions(questions);
    expect(asked.map((question) => [question.name, question.type])).toEqual([
      ["line0Kind", "choice"],
      ["line0Covered", "predicate"],
      ["line1Kind", "choice"],
      ["line1Covered", "predicate"],
      ["work", "score"],
      ["extra", "score"],
      ["education", "score"],
      ["seniority", "choice"],
      ["location", "choice"],
      ["thin", "predicate"],
    ]);
    expect(asked[4]).toMatchObject({ levels: [{ label: "0" }, { label: "1" }, { label: "2" }, { label: "3", description: expect.stringMatching(/^Closely matching/) }] });
    expect(asked[0]).toMatchObject({ choices: [{ value: "must" }, { value: "nice" }, { value: "other" }] });
    expect(asked[1].instructions).toMatch(/\nTrue: .+\nFalse: /);
  });
});

describe("decisionsAnswers", () => {
  it("reads every answer by its name", () => {
    expect(decisionsAnswers(result(), questions).answers).toMatchObject({
      line0Kind: { type: "choice", choice: "must" },
      line0Covered: { type: "noul", noul: 0.95 },
      work: { type: "score", score: 2.6 },
      thin: { type: "noul", noul: 0.05 },
    });
  });

  it("fails clearly on a refusal, a missing or second answer, an unknown choice or a score out of range", () => {
    expect(() => decisionsAnswers(result(answers({ work: { type: "refusal", name: "work" } })), questions)).toThrow("OpenAI Decisions refused to answer a scoring question. Try again, or score with another model.");
    const incomplete = "OpenAI Decisions didn't answer every scoring question. Try again.";
    expect(() => decisionsAnswers(result(answers().slice(1)), questions)).toThrow(incomplete);
    expect(() => decisionsAnswers(result([...answers(), answers()[0]]), questions)).toThrow(incomplete);
    expect(() => decisionsAnswers(result(answers({ seniority: { choice: "senior" } })), questions)).toThrow(incomplete);
    expect(() => decisionsAnswers(result(answers({ work: { score: 3.5 } })), questions)).toThrow(incomplete);
    expect(() => decisionsAnswers(result(answers({ thin: { type: "score", score: 1 } })), questions)).toThrow(incomplete);
    expect(() => decisionsAnswers({ answers: [] }, questions)).toThrow(incomplete);
  });

  it("leaves out a line whose question it refused, but not a factor's (#516)", () => {
    const refused = decisionsAnswers(result(answers({ line1Covered: { type: "refusal", probability: undefined } })), questions);
    expect([...refused.refusedLines]).toEqual([1]);
    expect(refused.answers).not.toHaveProperty("line1Covered");
    expect(decisionsAnswers(result(answers({ line0Kind: { type: "refusal" } })), questions).refusedLines).toEqual(new Set([0]));
    // The line's other question may be missing then, but no other answer may.
    expect(decisionsAnswers(result(answers({ line1Covered: { type: "refusal" } }).filter((answer) => answer.name !== "line1Kind")), questions).refusedLines).toEqual(new Set([1]));
    expect(() => decisionsAnswers(result(answers({ line1Covered: { type: "refusal" } }).filter((answer) => answer.name !== "work")), questions)).toThrow(
      "OpenAI Decisions didn't answer every scoring question. Try again.",
    );
    expect(() => decisionsAnswers(result(answers({ thin: { type: "refusal" } })), questions)).toThrow("OpenAI Decisions refused to answer a scoring question.");
    expect(() => decisionsAnswers(result(answers({ line1Covered: { type: "refusal", name: "line7Covered" } })), questions)).toThrow("OpenAI Decisions refused to answer a scoring question.");
  });
});

describe("askDecisions", () => {
  it("sends the state as JSON and the questions to OpenAI, with the key, once", async () => {
    const fetchImpl = vi.fn(async () => Response.json(result()));
    await askDecisions({ state: { posting: "p" }, questions }, { key: "sk-test", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DECISIONS_URL);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: "gpt-6-luna", input: [{ role: "user", content: [{ type: "input_json", data: { posting: "p" } }] }], questions: expect.any(Array) });

    // A sentence, as Test connection sends, goes as text: input_json takes only objects and lists.
    await askDecisions({ state: "Checking.", questions }, { key: "sk-test", fetchImpl });
    expect(JSON.parse((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ input: "Checking." });
  });

  it("tries a rate limit again, and says what's wrong with a key or a request too long", async () => {
    const answers = [new Response("", { status: 429 }), Response.json(result())];
    const retried = vi.fn(async () => answers.shift()!);
    await expect(askDecisions({ state: {}, questions }, { key: "k", fetchImpl: retried, retryDelaysMs: [1] })).resolves.toMatchObject({ model: "gpt-6-luna" });
    expect(retried).toHaveBeenCalledTimes(2);
    const status = (code: number) => vi.fn(async () => new Response("echoed request", { status: code }));
    await expect(askDecisions({ state: {}, questions }, { key: "k", fetchImpl: status(401), retryDelaysMs: [] })).rejects.toThrow(
      "OpenAI didn't accept the key. Check it, and that its project can use the Decisions API, in Settings → Scoring.",
    );
    await expect(askDecisions({ state: {}, questions }, { key: "k", fetchImpl: status(413), retryDelaysMs: [] })).rejects.toThrow("more than OpenAI Decisions can read at once");
    await expect(askDecisions({ state: {}, questions }, { key: "k", fetchImpl: status(503), retryDelaysMs: [] })).rejects.toThrow("OpenAI Decisions is overloaded right now. Try again in a moment.");
  });
});

describe("scoreWithDecisions", () => {
  it("answers the engine's questions about the posting's lines, counting the tokens", async () => {
    const fetchImpl = vi.fn(async () => Response.json(result()));
    const onUsage = vi.fn();
    const { answers: factors, scoredWith } = await scoreWithDecisions(posting, profile, { key: "k", fetchImpl, onUsage });
    expect(scoredWith).toBe(`${SCORE_POSTING_DECISIONS_VERSION} (gpt-6-luna)`);
    expect(factors.requirements).toEqual([
      { text: "5+ years of product design", mustHave: true, covered: true, evidence: null },
      { text: "Dutch is a plus", mustHave: false, covered: false, evidence: null },
    ]);
    expect(factors.work.value).toBeCloseTo(2.6 / 3);
    expect(onUsage).toHaveBeenCalledWith({ task: "score-posting-decisions", provider: "OPENAI_DECISIONS", model: "gpt-6-luna", input: 2400, output: 0 });
  });

  it("scores without a line it refused, and logs which line, never its text (#516)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => Response.json(result(answers({ line1Covered: { type: "refusal" } }))));
    const { answers: factors } = await scoreWithDecisions(posting, profile, { key: "k", fetchImpl });
    expect(factors.requirements).toEqual([{ text: "5+ years of product design", mustHave: true, covered: true, evidence: null }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("refused lines 1 of the posting"));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("Dutch");
    warn.mockRestore();
  });
});
