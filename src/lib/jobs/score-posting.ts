import "server-only";

import { z } from "zod";

import { fullText } from "@/lib/job-search/find";
import { foundPostingSchema, postingKey, type FoundPosting } from "@/lib/job-search/search";
import { saveScore } from "@/lib/posting-scores";
import { postingStates } from "@/lib/postings";
import { levelsProblem, listProfiles } from "@/lib/profiles";
import { breakdownSchema } from "@/lib/fit";
import { loadPostingScorer, loadScoringProfile } from "@/lib/scoring";

import { defineJob } from "./runner";

/** The key of a posting's scoring job, so a second click follows the one under way. */
export const scoreJobKey = (posting: Pick<FoundPosting, "source" | "externalId">) => `posting-score:${postingKey(posting)}`;

/** What a score job gives: the score, why, and how it adds up (E25-6). */
const fitResult = z.object({ score: z.number().int(), reasons: z.array(z.string()), redFlags: z.array(z.string()), breakdown: breakdownSchema.nullable().optional() });
const profileFitResult = fitResult.extend({ profileId: z.string(), profileName: z.string(), older: z.boolean().optional() });

/** Which profiles Score asks for (E25-5): one, or all of them; the first when it says none. */
export const scoreProfilesSchema = z.union([z.literal("all"), z.string().min(1)]).optional();

/**
 * Score in Positions (#208, E25-5): how well one posting fits one profile or
 * every profile, as the job agent scores them, with the scoring model
 * Settings → Scoring chose. A source that sent only the start of it is asked
 * for the rest first. Each score is kept with the posting; with all
 * profiles, those whose levels aren't chosen yet are left out. Gives the
 * posting's best score and all its scores, as Positions shows them.
 */
export const scorePostingJob = defineJob({
  type: "posting-score",
  input: z.object({ posting: foundPostingSchema, profiles: scoreProfilesSchema }),
  result: z.object({ score: profileFitResult.nullable(), scores: z.array(profileFitResult) }),
  async run({ posting, profiles: asked }, { step, signal }) {
    let description = posting.description;
    if (!posting.complete) {
      await step("Getting the whole posting");
      description = (await fullText(posting)) ?? posting.description;
    }
    const all = await listProfiles();
    const chosen = asked === "all" ? all : [all.find((profile) => profile.id === asked) ?? all[0]];
    const ready = asked === "all" ? (await Promise.all(chosen.map(async (profile) => ((await levelsProblem(profile.id)) ? [] : [profile])))).flat() : chosen;
    // None ready: say why, for the first.
    const scoring = ready.length > 0 ? ready : chosen.slice(0, 1);
    const score = await loadPostingScorer();
    for (const { id, name } of scoring) {
      await step(all.length > 1 ? `Scoring it against “${name}”` : "Scoring it against your profile");
      const profile = await loadScoringProfile(id);
      const { data, scoredWith } = await score({ ...posting, description }, profile, signal);
      await saveScore(posting, data, scoredWith, id);
    }
    const state = (await postingStates([posting])).get(postingKey(posting));
    return { score: state?.score ?? null, scores: state?.scores ?? [] };
  },
});

/**
 * Score in New application (public issue 66): the posting as pasted, with
 * the details as read, against the profile, with the same scorer. Nothing is
 * kept: a pasted posting has no source to keep a score under.
 */
export const scorePastedPostingJob = defineJob({
  type: "pasted-score",
  input: z.object({
    posting: z.string().trim().min(1).max(100_000),
    title: z.string().max(300),
    company: z.string().max(200),
    location: z.string().max(200),
    mode: z.string().max(200),
    salary: z.string().max(200),
    /** The profile chosen for the application (E24-6); the first when it's missing. */
    profileId: z.string().min(1).optional(),
  }),
  result: fitResult,
  async run({ posting, title, company, location, mode, salary, profileId }, { step, signal }) {
    await step("Scoring it against your profile");
    // Its levels first: scoring waits until they're chosen (E24-3, M5a).
    const profile = await loadScoringProfile(profileId);
    const score = await loadPostingScorer();
    const remote = /\b(remote|home ?office|hybrid)\b/i.test(mode) ? true : null;
    const { data } = await score({ title, company, place: location, remote, salary, description: posting }, profile, signal);
    return data;
  },
});

