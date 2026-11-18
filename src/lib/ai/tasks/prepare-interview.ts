import { z } from "zod";

import type { Extracted, Match } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import {
  applicationFacts,
  candidateFacts,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

const PREPARE_INTERVIEW_VERSION = "prepare-interview@1";

// "Getting ready" (E30-6, U3): a short checklist for the next interview,
// from the job's requirements and the interview, written only when the user
// clicks Prepare.

const answerSchema = z.object({ items: z.array(z.object({ text: z.string(), why: z.string() })) });

const INSTRUCTIONS = `You write a short checklist to help a candidate get ready for one job interview, as JSON.

- items: 4 to 6 things to do before this interview, most useful first. Each text is one short line that starts with a verb, e.g. "Prepare a payments story for the fintech gap".
- why: 2 to 5 words on where it comes from, e.g. "From a must-have", "For the payments gap", "From the posting".
- Build them from the job's requirements, the candidate's profile and the interview: a story for a strength the job asks for, an honest answer for a gap, questions to ask the people they'll meet, anything practical about the place or length.
- Never suggest claiming experience, skills or credentials the profile doesn't show.`;

export type PrepareInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  /** The round and what's known about it. */
  interview: { round: number; minutes: number | null; place: string; people: string };
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
};

/** E30-6: the checklist, 6 lines at most. */
export const prepareInterview: Task<PrepareInput, { text: string; why: string }[]> = async (provider, { profile, extracted, match, interview, facts }, options) => {
  const answer = await provider.complete({
    task: "prepare-interview",
    system: system(INSTRUCTIONS, truthfulness(options.strict), candidateFacts(profile, facts), languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          `The interview: round ${interview.round}${interview.minutes ? `, ${interview.minutes} minutes` : ""}${interview.place ? `, ${interview.place}` : ""}${interview.people.trim() ? `, with ${interview.people.split("\n").join(", ")}` : ""}.`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "interview_checklist",
    creativity: options.creativity,
    signal: options.signal,
  });
  const items = answer.items.map((item) => ({ text: item.text.trim(), why: item.why.trim() })).filter((item) => item.text);
  return { data: items.slice(0, 6), promptVersion: PREPARE_INTERVIEW_VERSION };
};
