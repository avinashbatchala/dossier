import type { Extracted } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";

import type { ChatTurn } from "./refine-chat";
import {
  applicationFacts,
  jobForPrompt,
  languageRule,
  MAX_POSTING_CHARACTERS,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const ANSWER_QUESTION_VERSION = "answer-question@1";

// Ask in an application's composer (E30-10, AP5, public issue 132): a
// question about the job and how the candidate fits it, answered from the
// profile, the posting and the facts for this application. Never from the
// notes, which no AI task reads, and it changes no document.

const INSTRUCTIONS = `You answer a candidate's question about one job they're applying for, in plain text.

- Answer from the candidate's profile, the job posting and what they tell you for this application, nothing else. Never claim they have experience, skills or credentials the profile doesn't show.
- When the answer isn't in them, say so plainly, and what the candidate could find out or add to their profile.
- You don't change their resume, cover letter or email here. If they ask for a change, say they can switch to Change and ask there.
- Be brief: a few sentences, or a short list with one "- " line per point.`;

/** Only the last messages go along; older ones rarely matter and cost context. */
const HISTORY = 10;

export type QuestionInput = {
  question: string;
  /** Earlier messages, oldest first. */
  history: ChatTurn[];
  profile: ProfileData;
  extracted: Extracted;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted. */
  posting: string;
};

/** E30-10: an answer in plain text, with no edits. */
export const answerQuestion: Task<QuestionInput, string> = async (provider, { question, history, profile, extracted, facts, posting }, options) => {
  const answer = await provider.complete({
    task: "answer-question",
    system: system(INSTRUCTIONS, languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, null)}`,
          posting.trim() && `The posting as pasted:\n${posting.slice(0, MAX_POSTING_CHARACTERS)}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
      { role: "assistant", content: "Understood. What would you like to know?" },
      ...history.slice(-HISTORY).map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user", content: question },
    ],
    creativity: "FAITHFUL",
    maxTokens: 800,
    signal: options.signal,
  });
  return { data: answer.trim(), promptVersion: ANSWER_QUESTION_VERSION };
};
