import { z } from "zod";

import type { ProfileData } from "@/lib/profile";

import { profileForPrompt, postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const SCORE_POSTING_VERSION = "score-posting@1";

/** How well a posting fits the profile, before any documents are written. */
export const agentScoreSchema = z.object({
  /** 0 is a poor fit, 100 an excellent one. */
  score: z.number().int().min(0).max(100),
  /** One to four short reasons, grounded in the posting and the profile. */
  reasons: z.array(z.string().trim().min(1).max(300)).min(1).max(4),
  /** What gives pause: missing must-haves, seniority, location or language. */
  redFlags: z.array(z.string().trim().min(1).max(300)).max(3).default([]),
});
export type AgentScore = z.infer<typeof agentScoreSchema>;

const INSTRUCTIONS = `You score how well a job posting fits a candidate before anyone writes an application.

Judge only what the posting and the candidate's profile show:
- skills and experience that match the posting's requirements
- seniority and scope
- location, remote policy and language, when the posting states them
- salary, when both the posting and the candidate's expectations say something

Give a score from 0 to 100:
- 85–100: excellent fit; the candidate clearly meets the core requirements.
- 70–84: good fit; most core requirements are covered, with a gap or two.
- 50–69: possible fit; meaningful gaps or a stretch.
- 0–49: poor fit.

Write one to four reasons for the score, each a short sentence that points at a specific requirement and a specific part of the profile. Never invent experience the profile doesn't show. Put real concerns in redFlags: a must-have skill that is missing, a seniority mismatch, a location or work-authorisation requirement the profile can't meet, or a language the candidate doesn't speak. Do not use age, gender, nationality, ethnicity, disability, family status or any other protected characteristic. If the posting is too thin to judge, say so in a reason and score conservatively.`;

export type ScorePostingInput = {
  posting: string;
  profile: ProfileData;
  title?: string;
  company?: string;
  place?: string;
  remote?: boolean | null;
  salary?: string;
};

/** E16-2: a cheap, explainable fit score before the agent spends on a draft. */
export const scorePosting: Task<ScorePostingInput, AgentScore> = async (provider, input, { signal }) => {
  const { posting, profile, title, company, place, remote, salary } = input;
  const data = await provider.complete({
    system: system(
      INSTRUCTIONS,
      UNTRUSTED_POSTING,
      "Use only facts in the candidate's profile. Never invent an employer, skill, date or credential.",
    ),
    messages: [
      {
        role: "user",
        content: JSON.stringify(
          {
            posting: {
              title: title ?? null,
              company: company ?? null,
              place: place ?? null,
              remote: remote ?? null,
              salary: salary ?? null,
            },
            postingText: postingForPrompt(posting),
            candidate: JSON.parse(profileForPrompt(profile)),
          },
          null,
          2,
        ),
      },
    ],
    schema: agentScoreSchema,
    schemaName: "posting_score",
    creativity: "FAITHFUL",
    effort: "low",
    signal,
  });
  return { data, promptVersion: SCORE_POSTING_VERSION };
};
