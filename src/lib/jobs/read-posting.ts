import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { extractPosting } from "@/lib/ai/tasks";
import { extractedSchema, matchFromRequirements, matchSchema } from "@/lib/application-data";
import { breakdownOf, breakdownSchema, type PostingFit } from "@/lib/fit";
import { stringsOf } from "@/lib/agent/candidates";
import { saveScore } from "@/lib/posting-scores";
import { prisma } from "@/lib/prisma";
import { levelsProblem, profileIdOr } from "@/lib/profiles";
import { loadPostingScorer, loadScoringProfile } from "@/lib/scoring";

import { READ_POSTING_STEPS } from "./application-steps";
import { defineJob } from "./runner";

/** A posting's score as the reading gives it: with its breakdown, whose requirements are How you match. */
const fitSchema = z.object({ score: z.number().int(), reasons: z.array(z.string()), redFlags: z.array(z.string()), breakdown: breakdownSchema.nullable().optional() });

/**
 * Reads a pasted posting and compares it with one profile (E7-2, NEW-2,
 * NEW-3, E25-7): the AI model picks out its details, and the scoring engine
 * scores it against the profile, whose requirements answers are How you
 * match. A posting from Positions already scored against that profile reuses
 * its answers, with no call; one scored now keeps its score there too.
 * Before the profile's levels are chosen, the posting is still read and only
 * the comparison waits (#518): `scoreWaits` says why. Saves nothing else:
 * the result waits in the job until the application is created.
 */
export const readPostingJob = defineJob({
  type: "read-posting",
  input: z.object({
    posting: z.string().trim().min(1).max(100_000),
    /** The profile it's compared with (E24-6); the first when it's missing, as in readings from before. */
    profileId: z.string().min(1).optional(),
    /** The posting in Positions it is, for its kept score (E25-7). */
    scored: z.object({ source: z.string(), externalId: z.string() }).optional(),
  }),
  result: z.object({
    extracted: extractedSchema,
    extractedWith: z.string(),
    match: matchSchema,
    matchedWith: z.string(),
    /** Its score against the profile (E25-7); missing in readings from before. */
    fit: fitSchema.optional(),
    /** Why it wasn't compared with the profile (#518): its levels aren't chosen yet. */
    scoreWaits: z.object({ message: z.string(), href: z.string() }).optional(),
  }),
  async run({ posting, profileId: asked, scored }, { step, signal }) {
    await step(READ_POSTING_STEPS[0]);
    const profileId = await profileIdOr(asked);
    const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);

    await step(READ_POSTING_STEPS[1]);
    const extraction = await extractPosting(provider, { posting }, { ...options, signal });

    await step(READ_POSTING_STEPS[2]);
    const kept = scored ? await prisma.postingScore.findUnique({ where: { source_externalId_profileId: { ...scored, profileId } } }) : null;
    const keptBreakdown = kept ? breakdownOf(kept.breakdown) : null;
    const waiting = kept && keptBreakdown ? null : await levelsProblem(profileId);
    if (waiting) {
      return {
        extracted: extraction.data,
        extractedWith: extraction.promptVersion,
        match: matchFromRequirements([]),
        matchedWith: "",
        scoreWaits: { message: `${waiting.message} Choose them in Profile → Jobs it's for.`, href: waiting.href },
      };
    }
    let fit: PostingFit;
    let scoredWith: string;
    if (kept && keptBreakdown) {
      fit = { score: kept.score, reasons: stringsOf(kept.reasons), redFlags: stringsOf(kept.redFlags), breakdown: keptBreakdown };
      scoredWith = kept.scoredWith;
    } else {
      const [score, profile] = await Promise.all([loadPostingScorer(), loadScoringProfile(profileId)]);
      const extracted = extraction.data;
      const remote = /\b(remote|home ?office)\b/i.test(extracted.mode ?? "") ? true : null;
      ({ data: fit, scoredWith } = await score(
        { title: extracted.title ?? extracted.role ?? "", company: extracted.company ?? "", place: extracted.location ?? "", remote, salary: extracted.salary ?? "", description: posting },
        profile,
        signal,
      ));
      if (scored) await saveScore(scored, fit, scoredWith, profileId);
    }

    return {
      extracted: extraction.data,
      extractedWith: extraction.promptVersion,
      match: matchFromRequirements(fit.breakdown?.requirements ?? []),
      matchedWith: scoredWith,
      fit,
    };
  },
});

export type ReadPostingResult = z.infer<typeof readPostingJob.result>;
