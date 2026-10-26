import { z } from "zod";

import type { Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";
import { FRAME_LABELS, isFrameUnit } from "@/lib/letter-frame";
import { TONES } from "@/lib/tones";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  COVER_LETTER_APPROACH,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";

export const WRITE_COVER_LETTER_VERSION = "write-cover-letter@5";

const answerSchema = z.object({
  recipient: z.string(),
  greeting: z.string(),
  paragraphs: z.array(z.object({ label: z.string(), text: z.string() })),
  signOff: z.string(),
});

const INSTRUCTIONS = `You write a candidate's cover letter for one job, as JSON.

- recipient: the address block, one line per line: who it's for (the company's hiring team, or the contact person the posting names, at the company), then the place if the job has one. Usual for a letter in its language, e.g. "Ledgerly · Hiring team\\nAmsterdam".
- greeting: the salutation before the first paragraph, usual for a letter in its language, with its punctuation: the contact person by name when the posting names one, else the hiring team, e.g. "Dear Ledgerly team,".
- paragraphs: 3–4 paragraphs, about 200–300 words together. Open with why this role and this company, then the problem the job is there to solve and where the candidate has solved it before, and close by inviting a conversation, with where the candidate is based if it matters for the job. No greeting, sign-off or name in them: those are separate.
- label: a short English name for each paragraph's purpose, e.g. "Why this role", "The challenge", "Where I've solved it", "Closing".
- Where the job asks for something the profile doesn't have ("gap"), don't claim it. If it matters, say so honestly in a sentence and show how the candidate would close the gap.
- signOff: the closing line before the name, matching the tone, with its punctuation (e.g. "Warm regards,").
- The sender's name, contact details and the date are added from the profile; don't write them.`;

export type CoverLetterInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted, for the fact guard. */
  posting: string;
};

/**
 * APP-10: the letter's recipient and greeting (units "recipient" and
 * "greeting", E8-11), its paragraphs as units, then its sign-off (unit
 * "sign-off"), which matches the tone. The sender, date and signature come
 * from the profile when the application is created (src/lib/letter-frame.ts).
 */
export const writeCoverLetter: Task<CoverLetterInput, Unit[]> = async (provider, { profile, extracted, match, tone, facts, posting }, options) => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      COVER_LETTER_APPROACH,
      `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      truthfulness(options.strict),
      candidateFacts(profile, facts),
      CREATIVITY[options.creativity],
      languageRule(options.language),
      UNTRUSTED_POSTING,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          `The job:\n${jobForPrompt(extracted, match)}`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "cover_letter",
    creativity: options.creativity,
    signal: options.signal,
  });

  // English letters get the tone's own sign-off; other languages keep the model's.
  const language = options.language ?? extracted.language ?? "English";
  const signOff = /^english$/i.test(language) || !answer.signOff.trim() ? TONES[tone].signOff : answer.signOff.trim();
  const units = unitsSchema.parse([
    // Left out when empty: the English ones fill in (src/lib/letter-frame.ts).
    ...(answer.recipient.trim() ? [{ id: "recipient", label: FRAME_LABELS.recipient, text: tidyLines(answer.recipient) }] : []),
    ...(answer.greeting.trim() ? [{ id: "greeting", label: FRAME_LABELS.greeting, text: answer.greeting.trim() }] : []),
    ...withoutFrame(answer.paragraphs, signOff)
      .filter((paragraph) => paragraph.text.trim())
      .map((paragraph, index) => ({ id: `paragraph:${index + 1}`, label: paragraph.label.trim() || `Paragraph ${index + 1}`, text: paragraph.text.trim() })),
    { id: SIGN_OFF_UNIT, label: "Sign-off", text: signOff },
  ]);
  return {
    // The recipient and greeting aren't claims about the candidate: only the paragraphs are checked.
    data: options.strict ? guardUnits(units, guardSources(profile, extracted, posting, facts)).map((unit) => (isFrameUnit(unit.id) ? units.find((entry) => entry.id === unit.id)! : unit)) : units,
    promptVersion: WRITE_COVER_LETTER_VERSION,
  };
};

/** An address block's lines, trimmed, without empty ones. */
const tidyLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");

const GREETING = /^\s*(?:dear|hi|hello|hey|good (?:morning|afternoon|day))\b[^\n]{0,60}[,!:]?\s*(?:\n|$)/i;

/**
 * The renderer adds the greeting, sign-off and name (APP-10); models add them
 * anyway sometimes. Takes a greeting line off the first paragraph and a
 * sign-off (with the name after it) off the last.
 */
export function withoutFrame<T extends { text: string }>(paragraphs: T[], signOff: string): T[] {
  if (paragraphs.length === 0) return paragraphs;
  const result = paragraphs.map((paragraph) => ({ ...paragraph }));
  result[0].text = result[0].text.replace(GREETING, "");
  const last = result.at(-1)!;
  const closings = [signOff, "Warm regards", "Kind regards", "Best regards", "Best", "Sincerely", "Yours sincerely", "Regards"];
  for (const closing of closings) {
    const escaped = closing.replace(/[,.]$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // On its own line, or right after the last sentence, maybe followed by a name.
    last.text = last.text.replace(new RegExp(`(?:\\n+|(?<=[.!?])[ \\t]+)\\s*${escaped}[,.]?(?:\\s*\\n[^\\n]{0,60})?\\s*$`, "i"), "").trim();
  }
  return result;
}
