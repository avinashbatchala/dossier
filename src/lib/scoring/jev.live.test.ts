import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { jevFit, jevParts, jevQuestions, jevScore, jevState, type JevParts } from "./jev";
import { postingLines } from "./posting-lines";
import { askJev } from "./typesafe";

// Checks against TypeSafe's real Jev (#274), skipped unless asked for. Each
// spends tokens on your TypeSafe account:
//
//   docker compose exec -e JEV_LIVE=check app yarn vitest run src/lib/scoring/jev.live.test.ts
//   docker compose exec -e JEV_LIVE=compare app yarn vitest run src/lib/scoring/jev.live.test.ts
//
// The key is DOSSIER_TYPESAFE_KEY when that's set, or else the one saved in
// Settings → Scoring. `check` scores two postings against the demo profile:
// one it fits, one it doesn't. `compare` scores the job agent's latest
// candidates again with Jev, against the profile in the database, and prints
// Jev's scores next to the AI model's and what was done with each posting,
// with the weights that would come closest to the AI model's scores. It
// saves nothing.

const live = new Set((process.env.JEV_LIVE ?? "").split(",").map((name) => name.trim()));
const COMPARED = 40;

/** The key the app would use: `.env` (DOSSIER_SECRET decrypts a saved key), then the database. */
async function liveKey(): Promise<string> {
  process.loadEnvFile(".env");
  const { jevKey, loadScoringConfig } = await import("./config");
  const jev = jevKey(await loadScoringConfig());
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

describe.skipIf(!live.has("check"))("Jev, live (#274)", () => {
  it("scores a posting the demo profile fits well, and one it doesn't", { timeout: 120_000 }, async () => {
    const key = await liveKey();
    const profile = demoProfile();
    const scores: number[] = [];
    for (const posting of [fitting, unfitting]) {
      const lines = postingLines(posting.description);
      const result = await askJev({ state: jevState(posting, profile), questions: jevQuestions(lines) }, { key });
      const parts = jevParts(result.answers, lines);
      const fit = jevFit(parts);
      console.log(`${posting.title}: ${result.model}, ${result.usage?.input_tokens ?? "?"} input tokens for ${lines.length} lines\n`, JSON.stringify({ ...fit, parts }, null, 2));
      scores.push(fit.score);
      expect(fit.reasons.length).toBeGreaterThan(0);
    }
    expect(scores[0]).toBeGreaterThanOrEqual(70);
    expect(scores[1]).toBeLessThan(50);
  });
});

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

function pearson(a: number[], b: number[]): number {
  const [ma, mb] = [mean(a), mean(b)];
  const covariance = a.reduce((sum, value, index) => sum + (value - ma) * (b[index] - mb), 0);
  const spread = (values: number[], m: number) => Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0));
  return covariance / (spread(a, ma) * spread(b, mb) || 1);
}

const ranks = (values: number[]) => values.map((value) => values.filter((other) => other < value).length + (values.filter((other) => other === value).length - 1) / 2);

/** How often a posting acted on scores above one passed on (ties count half): 0.5 is chance. */
function auc(acted: number[], passed: number[]): number {
  let wins = 0;
  for (const a of acted) for (const p of passed) wins += a > p ? 1 : a === p ? 0.5 : 0;
  return wins / Math.max(1, acted.length * passed.length);
}

/** Least squares for score ≈ w · (requirements, work, seniority), solved by Cramer's rule; weights summing to 1. */
function closestWeights(rows: { parts: JevParts; score: number }[]) {
  const x = rows.map(({ parts }) => [parts.requirements, parts.work, parts.seniority]);
  const y = rows.map(({ score }) => score / 100);
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => x.reduce((sum, row) => sum + row[i] * row[j], 0)));
  const v = [0, 1, 2].map((i) => x.reduce((sum, row, index) => sum + row[i] * y[index], 0));
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const w = [0, 1, 2].map((column) => Math.max(0, det(m.map((row, i) => row.map((value, j) => (j === column ? v[i] : value)))) / d));
  const total = w.reduce((sum, value) => sum + value, 0) || 1;
  return { requirements: w[0] / total, work: w[1] / total, seniority: w[2] / total };
}

describe.skipIf(!live.has("compare"))("Jev against the AI model's scores (#274)", () => {
  it("prints both for the job agent's latest candidates", { timeout: 600_000 }, async () => {
    const key = await liveKey();
    const [{ prisma }, { loadProfile }] = await Promise.all([import("@/lib/prisma"), import("@/lib/profile-data")]);
    const profile = await loadProfile();
    const candidates = await prisma.agentCandidate.findMany({
      where: { description: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: COMPARED,
      select: { title: true, company: true, place: true, remote: true, salary: true, description: true, score: true, status: true },
    });
    expect(candidates.length, "The job agent has no candidates with a posting's text in this database.").toBeGreaterThan(0);

    const rows: { title: string; status: string; ai: number; jev: number; parts: JevParts; score: number }[] = [];
    for (const candidate of candidates) {
      const lines = postingLines(candidate.description);
      const result = await askJev({ state: jevState(candidate, profile), questions: jevQuestions(lines) }, { key });
      const parts = jevParts(result.answers, lines);
      rows.push({ title: `${candidate.company}: ${candidate.title}`.slice(0, 60), status: candidate.status, ai: candidate.score, jev: jevScore(parts), parts, score: candidate.score });
    }

    console.table(
      rows.map(({ title, status, ai, jev, parts }) => ({
        title,
        status,
        ai,
        jev,
        requirements: parts.requirements.toFixed(2),
        work: parts.work.toFixed(2),
        seniority: parts.seniority.toFixed(2),
      })),
    );
    const ai = rows.map((row) => row.ai);
    const jev = rows.map((row) => row.jev);
    const acted = rows.filter((row) => ["DRAFTING", "DRAFTED", "APPROVED"].includes(row.status));
    const passed = rows.filter((row) => row.status === "DISMISSED");
    console.log(
      [
        `${rows.length} postings`,
        `Pearson ${pearson(ai, jev).toFixed(2)}, Spearman ${pearson(ranks(ai), ranks(jev)).toFixed(2)}, mean difference ${mean(rows.map((row) => Math.abs(row.ai - row.jev))).toFixed(1)} points`,
        `Acted on ${acted.length}, passed on ${passed.length}: AUC AI ${auc(acted.map((row) => row.ai), passed.map((row) => row.ai)).toFixed(2)}, Jev ${auc(acted.map((row) => row.jev), passed.map((row) => row.jev)).toFixed(2)}`,
        `Weights closest to the AI model's scores: ${JSON.stringify(closestWeights(rows))}`,
      ].join("\n"),
    );
  });
});
