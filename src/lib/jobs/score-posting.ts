import "server-only";

import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { scorePosting } from "@/lib/ai/tasks";
import { fullText } from "@/lib/job-search/find";
import { foundPostingSchema, postingKey, postingText, type FoundPosting } from "@/lib/job-search/search";
import { saveScore } from "@/lib/posting-scores";
import { loadProfile } from "@/lib/profile-data";

import { defineJob } from "./runner";

/** The key of a posting's scoring job, so a second click follows the one under way. */
export const scoreJobKey = (posting: Pick<FoundPosting, "source" | "externalId">) => `posting-score:${postingKey(posting)}`;

/**
 * Score in Find jobs (#208): how well one posting fits the profile, as the
 * job agent scores them (score-posting). A source that sent only the start
 * of it is asked for the rest first. The score is kept with the posting.
 */
export const scorePostingJob = defineJob({
  type: "posting-score",
  input: z.object({ posting: foundPostingSchema }),
  result: z.object({ score: z.number().int(), reasons: z.array(z.string()), redFlags: z.array(z.string()) }),
  async run({ posting }, { step, signal }) {
    let description = posting.description;
    if (!posting.complete) {
      await step("Getting the whole posting");
      description = (await fullText(posting)) ?? posting.description;
    }
    await step("Scoring it against your profile");
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
    const { data, promptVersion } = await scorePosting(
      provider,
      { posting: postingText({ ...posting, description }), title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, salary: posting.salary, profile },
      { ...options, signal },
    );
    await saveScore(posting, data, promptVersion);
    return data;
  },
});
