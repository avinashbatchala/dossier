import "server-only";

import { z } from "zod";

import { levelsProblem, listProfiles } from "@/lib/profiles";
import { loadPostingScorer, loadScoringProfile } from "@/lib/scoring";
import { saveStartupScore, startupPosting } from "@/lib/startups/store";

import { scoreProfilesSchema } from "./score-posting";
import { defineJob } from "./runner";

/** The key of a startup's scoring job, so a second click follows the one under way. */
export const startupScoreJobKey = (id: string) => `startup-score:${id}`;

/**
 * Score on a startup (#524): how well its post fits one profile or every
 * profile, with the scoring model Settings → Scoring chose, as Positions
 * scores a posting. The best profile's score replaces the keyword match,
 * with its reasons and red flags; with all profiles, those whose levels
 * aren't chosen yet are left out.
 */
export const scoreStartupJob = defineJob({
  type: "startup-score",
  input: z.object({ id: z.string().min(1), profiles: scoreProfilesSchema }),
  result: z.object({ score: z.number().int(), profileId: z.string() }),
  async run({ id, profiles: asked }, { step, signal }) {
    const posting = await startupPosting(id);
    if (!posting) throw new Error("That startup is no longer in the list.");
    const all = await listProfiles();
    const chosen = asked === "all" ? all : [all.find((profile) => profile.id === asked) ?? all[0]];
    const ready = asked === "all" ? (await Promise.all(chosen.map(async (profile) => ((await levelsProblem(profile.id)) ? [] : [profile])))).flat() : chosen;
    // None ready: say why, for the first.
    const scoring = ready.length > 0 ? ready : chosen.slice(0, 1);
    const score = await loadPostingScorer();
    let best: { fit: { score: number; reasons: string[]; redFlags: string[] }; scoredWith: string; profileId: string } | null = null;
    for (const { id: profileId, name } of scoring) {
      await step(all.length > 1 ? `Scoring it against “${name}”` : "Scoring it against your profile");
      const { data, scoredWith } = await score(posting, await loadScoringProfile(profileId), signal);
      if (!best || data.score > best.fit.score) best = { fit: data, scoredWith, profileId };
    }
    const saved = await saveStartupScore(id, best!.fit, best!.scoredWith, best!.profileId);
    return { score: saved.score, profileId: best!.profileId };
  },
});
