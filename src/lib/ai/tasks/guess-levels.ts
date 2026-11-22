import { z } from "zod";

import { experienceMonths, type ProfileData } from "@/lib/profile";
import { levelRange, type LevelRange } from "@/lib/profile-levels";

import { profileForPrompt, system, type Task } from "./prompt-parts";

export const GUESS_LEVELS_VERSION = "guess-levels@1";

// "Guess with AI" on a profile's levels (E24-3, #404): the range of job
// levels the profile's roles point to. Only when the user asks; the user
// can change it, and scoring never guesses a level itself.

const answerSchema = z.object({ from: z.string(), to: z.string() });

const INSTRUCTIONS = `You say which job levels a candidate's profile is for, as JSON: the lowest and highest of five steps they'd apply for now.

The steps, lowest first:
- intern: an internship, while studying or just after
- junior: entry level, the first years of work
- mid: mid level, working on their own
- senior: senior, leading work and others without managing them
- lead: lead, head of, manager or director

Judge from the profile's roles: their titles, their scope and what the bullets say the candidate did, and the years of work given. A range usually spans one or two steps: someone who leads a team today may look at senior and lead roles. Volunteering and projects count for little. Never use age or any other protected characteristic.`;

export type GuessLevelsInput = { profile: ProfileData; today?: Date };

/** E24-3: the levels the profile's roles point to. Contact details and references are never sent. */
export const guessLevels: Task<GuessLevelsInput, LevelRange> = async (provider, { profile, today = new Date() }, { signal }) => {
  const years = Math.floor(experienceMonths(profile, today) / 12);
  const answer = await provider.complete({
    task: "guess-levels",
    system: system(INSTRUCTIONS, "Use only what's in the candidate's profile."),
    messages: [
      {
        role: "user",
        content: [`The candidate's profile:\n${profileForPrompt(profile)}`, `Their work experience: ${years === 1 ? "about 1 year" : `about ${years} years`} in all.`].join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "profile_levels",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  // A step the model made up reads as mid level, the middle of the five.
  return { data: levelRange(answer.from, answer.to) ?? levelRange(answer.from, answer.from) ?? levelRange(answer.to, answer.to) ?? { from: "mid", to: "mid" }, promptVersion: GUESS_LEVELS_VERSION };
};
