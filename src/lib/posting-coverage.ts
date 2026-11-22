import type { Breakdown } from "@/lib/scoring/factors";

// Coverage for postings (E32-2, U1, decided 16 and 17 November 2026): how
// many of a posting's requirements the profile covers, from its score's
// breakdown. It's what rings show, lists sort by and cut-offs ask for; the
// 0–100 score no longer decides anything for postings.

/** Requirements covered, in all, and must-haves not covered. */
export type Coverage = { hit: number; total: number; mustMissing: number };

export const NO_COVERAGE: Coverage = { hit: 0, total: 0, mustMissing: 0 };

/** A score's coverage; a score without a breakdown, or none, covers 0 of 0. */
export function coverageOf(fit: { breakdown?: Breakdown | null } | null | undefined): Coverage {
  const requirements = fit?.breakdown?.requirements ?? [];
  return {
    hit: requirements.filter((requirement) => requirement.covered).length,
    total: requirements.length,
    mustMissing: requirements.filter((requirement) => requirement.mustHave && !requirement.covered).length,
  };
}

/** The share covered, or -1 for 0 of 0, which sorts after every scored posting. */
const share = ({ hit, total }: Coverage) => (total > 0 ? hit / total : -1);

/**
 * "Best fit": the larger share covered first; at the same share, fewer
 * missing must-haves, then the most recently found (decided 17 November).
 */
export function byBestFit<T extends { coverage: Coverage; at: number }>(a: T, b: T): number {
  return share(b.coverage) - share(a.coverage) || a.coverage.mustMissing - b.coverage.mustMissing || b.at - a.at;
}

/** The better of two coverages, as Best fit orders them. */
export const betterCoverage = (a: Coverage, b: Coverage): Coverage => (byBestFit({ coverage: a, at: 0 }, { coverage: b, at: 0 }) <= 0 ? a : b);

/** A cut-off: the agent's minimum and the Positions filter. */
export const COVERS = ["any", "half", "two-thirds", "all"] as const;
export type Covers = (typeof COVERS)[number];

export const COVERS_LABELS: Record<Covers, string> = { any: "Any", half: "At least half", "two-thirds": "At least two thirds", all: "All of them" };
const MINIMUM: Record<Covers, number> = { any: 0, half: 0.5, "two-thirds": 2 / 3, all: 1 };

/** Whether a coverage passes a cut-off; 0 of 0 passes only "any". */
export function passes(coverage: Coverage, covers: Covers): boolean {
  if (covers === "any") return true;
  // A hair under, so two thirds of 3 passes "two thirds".
  return coverage.total > 0 && coverage.hit / coverage.total >= MINIMUM[covers] - 1e-9;
}

/** A saved 0–100 minimum as a cut-off: 50–65 → half, 70–85 → two thirds, 90 and up → all; under 50 → any. */
export function coversFromScore(score: number): Covers {
  return score >= 90 ? "all" : score >= 70 ? "two-thirds" : score >= 50 ? "half" : "any";
}

/** "Covers at least half" in a sentence, or null for any. */
export const coversLine = (covers: Covers): string | null =>
  covers === "any" ? null : covers === "all" ? "covers every requirement" : `covers at least ${covers === "half" ? "half" : "two thirds"} of the requirements`;

/** Words for a coverage, as the application's Fit column says them: "Strong fit". */
export function fitWords({ hit, total, mustMissing }: Coverage): string {
  if (total === 0) return "No requirements to check";
  const share = hit / total;
  if (share >= 0.7 && mustMissing === 0) return "Strong fit";
  if (share >= 0.5) return "Good fit";
  if (share >= 0.3) return "Partial fit";
  return "Long shot";
}

/**
 * A stored reason or red flag without the points that add up to the 0–100
 * score (E32-2): "Requirements 30/35: You show 5 of 6" reads "Requirements:
 * You show 5 of 6", and "Capped at 69: …" loses its number.
 */
export const withoutPoints = (line: string): string => line.replace(/^Capped at \d+: /, "").replace(/^([^:]{1,40}?) \d+(?:\.\d+)?\/\d+: /, "$1: ");
