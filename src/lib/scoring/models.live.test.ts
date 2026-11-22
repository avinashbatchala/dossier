import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import type { Scorer } from "./scorers";

// Checks against the real OpenAI Decisions and OpenRouter (E25-3, E25-4),
// skipped unless asked for. Each spends a little on your account:
//
//   docker compose exec -e SCORING_LIVE=openai-decisions app yarn vitest run src/lib/scoring/models.live.test.ts
//   docker compose exec -e SCORING_LIVE=openrouter app yarn vitest run src/lib/scoring/models.live.test.ts
//
// The keys, and OpenRouter's model, are those saved in Settings → Scoring
// (`.env`'s DOSSIER_SECRET decrypts them). Each scores two postings against
// the demo profile, one it fits and one it doesn't, through the engine as
// Dossier does, and prints how each adds up. It saves nothing.

const live = new Set((process.env.SCORING_LIVE ?? "").split(",").map((name) => name.trim()));

const fitting = {
  title: "Senior Product Designer",
  company: "Ledgerly",
  place: "Amsterdam",
  remote: false,
  salary: "€75,000–€90,000",
  description: [
    "Ledgerly makes accounting software for small businesses across the Netherlands.",
    "",
    "What you'll do:",
    "- Lead the design of our invoicing product, from research to shipped screens",
    "- Grow and maintain our design system in Figma",
    "",
    "What you bring:",
    "- 5+ years of product design, ideally on complex B2B tools",
    "- Experience building and maintaining a design system",
    "- Strong prototyping skills and hands-on user research",
    "- You run workshops with product and engineering",
    "- Fluent English; Dutch is a plus",
  ].join("\n"),
};

const unfitting = {
  title: "Senior Embedded Software Engineer",
  company: "Antrieb Systems",
  place: "Munich",
  remote: false,
  salary: "",
  description: [
    "Antrieb Systems builds motor controllers for electric vehicles.",
    "",
    "Your profile:",
    "- 7+ years of embedded software development in C and C++",
    "- Experience with real-time operating systems such as FreeRTOS or AUTOSAR",
    "- Knowledge of CAN and automotive safety standards (ISO 26262)",
    "- A degree in electrical engineering or computer science",
    "- Fluent German (C1 or better), as you'll work on site in Munich every day",
  ].join("\n"),
};

/** Scores both postings with `scorer`, set up as the app would, with what's saved in Settings → Scoring. */
async function scoreBoth(scorer: Scorer) {
  process.loadEnvFile(".env");
  const [{ loadScoringConfig }, { SCORING_MODELS }, { fitFromAnswers }] = await Promise.all([import("./config"), import("./models"), import("@/lib/fit")]);
  const config = { ...(await loadScoringConfig()), scorer };
  const problem = await SCORING_MODELS[scorer].problem(config);
  if (problem) throw new Error(problem);
  const answer = await SCORING_MODELS[scorer].load(config);
  const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
  const scores: number[] = [];
  for (const posting of [fitting, unfitting]) {
    const { answers, scoredWith } = await answer(posting, profile, AbortSignal.timeout(120_000));
    const fit = fitFromAnswers(answers);
    console.log(`${posting.title}: ${scoredWith}\n`, JSON.stringify(fit, null, 2));
    scores.push(fit.score);
  }
  return scores;
}

describe.skipIf(!live.has("openai-decisions"))("OpenAI Decisions, live (E25-3)", () => {
  it("scores a posting the demo profile fits well higher than one it doesn't", { timeout: 300_000 }, async () => {
    const [fits, doesnt] = await scoreBoth("DECISIONS");
    expect(fits).toBeGreaterThanOrEqual(70);
    expect(doesnt).toBeLessThan(50);
  });
});

describe.skipIf(!live.has("openrouter"))("OpenRouter, live (E25-4)", () => {
  it("scores a posting the demo profile fits well higher than one it doesn't", { timeout: 300_000 }, async () => {
    const [fits, doesnt] = await scoreBoth("OPENROUTER");
    expect(fits).toBeGreaterThanOrEqual(70);
    expect(doesnt).toBeLessThan(50);
  });
});
