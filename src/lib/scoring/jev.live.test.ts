import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { fitFromAnswers } from "@/lib/fit";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import { scoreWithJev } from "./jev";

// Checks against TypeSafe's real Jev (#274, E25), skipped unless asked for.
// It spends tokens on your TypeSafe account:
//
//   docker compose exec -e JEV_LIVE=check app yarn vitest run src/lib/scoring/jev.live.test.ts
//
// The key is DOSSIER_TYPESAFE_KEY when that's set, or else the one saved in
// Settings → Scoring. It scores two postings against the demo profile, one
// it fits and one it doesn't, and prints how each adds up. It saves nothing.

const live = new Set((process.env.JEV_LIVE ?? "").split(",").map((name) => name.trim()));

/** The key the app would use: `.env` (DOSSIER_SECRET decrypts a saved key), then the database. */
async function liveKey(): Promise<string> {
  process.loadEnvFile(".env");
  const { loadScoringConfig, scorerKey } = await import("./config");
  const jev = scorerKey(await loadScoringConfig(), "JEV");
  if (jev.problem !== null) throw new Error(`${jev.problem} Or set DOSSIER_TYPESAFE_KEY.`);
  return jev.key;
}

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

describe.skipIf(!live.has("check"))("Jev, live (#274, E25)", () => {
  it("scores a posting the demo profile fits well, and one it doesn't", { timeout: 120_000 }, async () => {
    const key = await liveKey();
    const profile = { data: demoProfile(), levels: { from: "senior" as const, to: "lead" as const }, workplace: DEFAULT_WORKPLACE };
    const scores: number[] = [];
    for (const posting of [fitting, unfitting]) {
      const { answers, scoredWith } = await scoreWithJev(posting, profile, { key });
      const fit = fitFromAnswers(answers);
      console.log(`${posting.title}: ${scoredWith}\n`, JSON.stringify(fit, null, 2));
      scores.push(fit.score);
    }
    expect(scores[0]).toBeGreaterThanOrEqual(70);
    expect(scores[1]).toBeLessThan(50);
  });
});
