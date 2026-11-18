import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { prepareInterview } from "@/lib/ai/tasks";
import { extractedOf, matchSchema } from "@/lib/application-data";
import { profileOfApplication } from "@/lib/frozen-copy";
import { prepSchema } from "@/lib/interviews";
import { prisma } from "@/lib/prisma";
import { loadFactTexts } from "@/lib/profile-data";

import { defineJob } from "./runner";

/** The key of getting an application ready for its interview, to find it again after a reload. */
export const prepareJobKey = (applicationId: string) => `prepare:${applicationId}`;

/**
 * "Prepare" (E30-6): writes the "Getting ready" checklist for one round from
 * the job's requirements and the interview, and keeps it on the round,
 * unticked. Only ever started by a click.
 */
export const prepareInterviewJob = defineJob({
  type: "prepare-interview",
  input: z.object({ applicationId: z.string().min(1), interviewId: z.string().min(1) }),
  result: prepSchema,
  async run({ applicationId, interviewId }, { step, signal }) {
    await step("Getting you ready");
    const interview = await prisma.interview.findFirstOrThrow({ where: { id: interviewId, applicationId }, include: { application: true } });
    const { application } = interview;
    const match = matchSchema.safeParse(application.match);
    const [provider, options, profile, facts] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      profileOfApplication(application.frozen, application.profileId),
      loadFactTexts(applicationId),
    ]);
    const { data, promptVersion } = await prepareInterview(
      provider,
      {
        profile,
        extracted: extractedOf(application),
        match: match.success ? match.data : null,
        interview: { round: interview.round, minutes: interview.minutes, place: interview.place, people: interview.people },
        facts,
      },
      { ...options, language: application.language || options.language, signal },
    );
    const prep = data.map((item) => ({ ...item, done: false }));
    await prisma.interview.update({ where: { id: interviewId }, data: { prep, prepWrittenWith: promptVersion } });
    return prep;
  },
});
