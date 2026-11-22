import type { ReactNode } from "react";

import type { PostingFit } from "@/lib/fit";
import { coverageOf, fitWords, withoutPoints } from "@/lib/posting-coverage";
import { FACTORS } from "@/lib/scoring/factors";

import { PreviewReasons } from "./listing";
import { ScoreRing } from "./score-ring";

/**
 * How a posting fits one profile (#208, E25-6, E32-2): the requirements it
 * covers as a ring with words, then each part of the fit as a reason, ✓ in
 * its favour or – against, and what held it back. Never a number out of 100
 * (U1). A score without a breakdown shows its reasons and red flags; `older`
 * says it's from before the breakdown existed.
 */
export function FitDetails({ fit, older = false, note }: { fit: PostingFit; older?: boolean; /** Under the words: "Scored against Product design · Score again". */ note?: ReactNode }) {
  const coverage = coverageOf(fit);
  const { breakdown } = fit;
  const reasons = breakdown
    ? [
        ...breakdown.factors
          .filter((line) => line.max > 0 && line.reason.trim())
          .map((line) => ({ text: `${FACTORS.find((factor) => factor.id === line.factor)!.label}: ${line.reason}`, good: line.points >= line.max / 2 })),
        ...(breakdown.cap ? [{ text: breakdown.cap.reason, good: false }] : []),
      ]
    : [...fit.reasons.map((reason) => ({ text: withoutPoints(reason), good: true })), ...fit.redFlags.map((flag) => ({ text: withoutPoints(flag), good: false }))];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5">
        <ScoreRing hit={coverage.hit} total={coverage.total} size="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[15px] font-medium text-ink">{fitWords(coverage)}</p>
          <p className="text-meta text-muted">
            {coverage.total > 0 ? `${coverage.hit} of ${coverage.total} requirements covered` : "The posting lists none to check"}
            {note && <> · {note}</>}
          </p>
        </div>
      </div>
      {reasons.length > 0 && <PreviewReasons reasons={reasons} />}
      {older && <p className="text-meta text-muted">An older score, from before scores showed how they add up. Score it again to see that.</p>}
    </div>
  );
}
