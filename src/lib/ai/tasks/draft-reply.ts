import { z } from "zod";

import type { Tone } from "@/generated/prisma/enums";
import type { Extracted } from "@/lib/application-data";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

import { factSources, guardSources, unverifiedFacts } from "../fact-guard";

import { emailForPrompt, UNTRUSTED_EMAIL } from "./classify-reply";
import { CREATIVITY, jobForPrompt, NO_EM_DASHES, profileForPrompt, system, truthfulness, type Task } from "./prompt-parts";

export const DRAFT_REPLY_VERSION = "draft-reply@2";

const answerSchema = z.object({
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  signOff: z.string(),
  /** What the profile can't answer, as short questions to the candidate. */
  gaps: z.array(z.string()),
});

const INSTRUCTIONS = `You write a job candidate's answer to an email from an employer about their application, as JSON. Write it as the candidate, in the email's language.

- greeting: the salutation to the person who wrote, with its punctuation, e.g. "Hi Anna,".
- paragraphs: one to three short paragraphs that answer every question the email asks, briefly and warmly. When times to meet are given below, offer exactly those, each on its own line starting with "• ", and say any of them works. When they've already settled on a time, confirm it. No greeting, sign-off or name in them.
- Answer only from the candidate's profile, the job and what the candidate adds. When the email asks something they don't tell you, such as a notice period, salary expectations or a start date, write "[…]" in its place and add a short question for the candidate to gaps, e.g. "What is your notice period?". Never guess those.
- signOff: the closing line before the name, with its punctuation (e.g. "Best regards,"). The candidate's name is added after it; don't write it.`;

export type DraftReplyInput = {
  profile: ProfileData;
  extracted: Extracted | null;
  tone: Tone;
  /** The email to answer. */
  email: { from: string; subject: string; body: string; sentAt: Date };
  /** The candidate's time zone, for the email's date. */
  timeZone: string;
  /** The application's earlier mail, oldest first, for context. */
  thread: string[];
  /** Free times to offer, already written out, e.g. "Tue 21 Oct, 10:00–10:45 (Europe/Berlin)". */
  slots: string[];
  /** What the candidate adds, e.g. "Notice period: 3 months" or "make it shorter". */
  note: string;
  /** The application's posting, for the fact guard. */
  posting: string;
};

export type DraftedReply = { body: string; gaps: string[]; unverified: string[] };

/** Drafts the answer to an employer's email (E15-4), with what it couldn't answer from the profile. */
export const draftReply: Task<DraftReplyInput, DraftedReply> = async (provider, input, options) => {
  const { profile, extracted, tone, email, timeZone, thread, slots, note, posting } = input;
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
      `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      truthfulness(options.strict),
      CREATIVITY[options.creativity],
      UNTRUSTED_EMAIL,
      NO_EM_DASHES,
    ),
    messages: [
      {
        role: "user",
        content: [
          `The candidate's profile:\n${profileForPrompt(profile)}`,
          extracted && `The job:\n${jobForPrompt(extracted, null)}`,
          thread.length > 0 && `Earlier in this conversation:\n${thread.map((entry) => `<earlier>\n${entry}\n</earlier>`).join("\n")}`,
          `The email to answer:\n${emailForPrompt(email, timeZone)}`,
          slots.length > 0 ? `Times to offer:\n${slots.map((slot) => `• ${slot}`).join("\n")}` : "No times to offer: don't propose any.",
          note.trim() && `The candidate adds: ${note.trim()}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "reply_draft",
    creativity: options.creativity,
    signal: options.signal,
  });

  const signOff = answer.signOff.trim() || TONES[tone].signOff;
  const body = [answer.greeting.trim(), ...answer.paragraphs.map((text) => text.trim()).filter(Boolean), [signOff, profile.basics.name.trim()].filter(Boolean).join("\n")]
    .filter(Boolean)
    .join("\n\n");
  // The employer's mail, the note and the slots may be quoted back: they back facts too.
  const sources = options.strict
    ? factSources([guardSources(profile, extracted, posting).text, email.body, email.from, email.subject, note, ...slots, ...thread])
    : null;
  return {
    data: { body, gaps: answer.gaps.map((gap) => gap.trim()).filter(Boolean), unverified: sources ? unverifiedFacts(body, sources) : [] },
    promptVersion: DRAFT_REPLY_VERSION,
  };
};
