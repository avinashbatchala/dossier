import "server-only";

import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import { matchFromRequirements, matchSchema } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import { loadPostingScorer, loadScoringProfile } from "@/lib/scoring";

import { defineJob } from "./runner";

/** The key of checking an application's requirements, to find it again after a reload. */
export const checkRequirementsJobKey = (applicationId: string) => `check-requirements:${applicationId}`;

/**
 * "Check again" (E30-1, decided 16 November 2026): checks the posting's
 * requirements against the application's profile as it is now, with the
 * scoring model in Settings → Scoring, as when the posting was first read.
 * The match it had stays until the new one is in, and stays too when the
 * check finds no requirements at all.
 */
export const checkRequirementsJob = defineJob({
  type: "check-requirements",
  input: z.object({ applicationId: z.string().min(1) }),
  result: matchSchema,
  async run({ applicationId }, { step, signal }) {
    await step("Checking the requirements");
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { profileId: true, title: true, role: true, company: true, location: true, mode: true, salary: true, postingText: true },
    });
    // Said as it is, like an AI provider that isn't set up.
    if (!application.postingText.trim()) throw AiError.config("This application has no posting to check against.");

    const [score, profile] = await Promise.all([loadPostingScorer(), loadScoringProfile(application.profileId)]);
    const { data: fit, scoredWith } = await score(
      {
        title: application.role || application.title,
        company: application.company,
        place: application.location,
        remote: /\b(remote|home ?office)\b/i.test(`${application.mode} ${application.location}`) ? true : null,
        salary: application.salary,
        description: application.postingText,
      },
      profile,
      signal,
    );
    const match = matchFromRequirements(fit.breakdown?.requirements ?? []);
    if (match.items.length === 0) throw AiError.config("The check found no requirements in the posting this time, so the last one stays.");
    await prisma.application.update({ where: { id: applicationId }, data: { match, matchedWith: scoredWith } });
    return match;
  },
});
