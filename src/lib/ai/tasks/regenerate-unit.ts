import { z } from "zod";

import { DocumentKind, type Tone } from "@/generated/prisma/enums";
import { SIGN_OFF_UNIT, type Extracted, type Unit } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { isFrameUnit } from "@/lib/letter-frame";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";
import { bulletLines, isBulletUnit } from "@/lib/unit-text";

import { guardSources, guardUnits } from "../fact-guard";

import {
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

export const REGENERATE_UNIT_VERSION = "regenerate-unit@5";

/** What the letter's frame parts are, for the model (E8-11). */
const FRAME_PARTS: Record<string, string> = {
  greeting:
    "It's the letter's greeting: the salutation before the first paragraph, usual for a letter in its language, with its punctuation, to the contact person the posting names, else the hiring team.",
  recipient:
    "It's the letter's address block, one line per line: who it's for (the company's hiring team, or the contact person the posting names, at the company), then the place if the job has one.",
};

/** What the email's parts are, for the model. */
const EMAIL_PARTS: Record<string, string> = {
  subject: "It's the email's subject line: the role and the candidate's name, or the reference or subject line the posting asks for. One line.",
  body: "It's the email's whole message, sent with the resume and cover letter attached: the greeting (to the contact person the posting names, else the hiring team), two or three short paragraphs (about 80–150 words together) on the role the candidate is applying for, what makes them a strong fit and that the resume and cover letter are attached, then the sign-off and the candidate's name. A blank line between paragraphs. It doesn't repeat the cover letter.",
};

/** What each document is called in the prompt. */
const DOCUMENT_NAMES: Record<DocumentKind, string> = {
  [DocumentKind.RESUME]: "resume",
  [DocumentKind.COVER_LETTER]: "cover letter",
  [DocumentKind.EMAIL]: "application email",
};

const answerSchema = z.object({ text: z.string() });

export type RegenerateInput = {
  kind: DocumentKind;
  /** The part to write again. */
  unit: Unit;
  /** The whole document, for context and to avoid repeating other parts. */
  document: Unit[];
  profile: ProfileData;
  extracted: Extracted;
  tone: Tone;
  note: string;
  /** The posting as pasted, for the fact guard. */
  posting: string;
};

/** APP-5: a fresh version of one part, the rest left alone; the unit comes back with its new text. */
export const regenerateUnit: Task<RegenerateInput, Unit> = async (provider, input, options) => {
  const { kind, unit, document, profile, extracted, tone, note, posting } = input;
  const bullets = isBulletUnit(unit.id);
  const isProject = unit.id.startsWith("project:");
  const what = DOCUMENT_NAMES[kind];
  const answer = await provider.complete({
    system: system(
      `You write a new version of one part of a candidate's ${what} for one job, as JSON with the new text.`,
      `Keep its purpose and about its length, but phrase it differently from the current version, and don't repeat what other parts already say.${
        bullets
          ? isProject
            ? " It's a project: answer 1–3 bullets, one per line, each starting with a verb, without bullet characters."
            : " It's a role: answer 2–5 bullets, one per line, each starting with a verb, without bullet characters."
          : ""
      }`,
      // The letter's greeting and address block aren't where its argument goes.
      kind === DocumentKind.COVER_LETTER && !isFrameUnit(unit.id) && COVER_LETTER_APPROACH,
      kind !== DocumentKind.RESUME && `Tone: ${TONES[tone].label}. ${TONES[tone].description}`,
      kind === DocumentKind.COVER_LETTER && FRAME_PARTS[unit.id],
      kind === DocumentKind.EMAIL && EMAIL_PARTS[unit.id],
      truthfulness(options.strict),
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
          `The job:\n${jobForPrompt(extracted, null)}`,
          `The whole ${what} now:\n${JSON.stringify(document, null, 2)}`,
          note.trim() && `The candidate adds: ${note.trim()}`,
          `Write a new version of "${unit.label}" (${unit.id}). Its current text:\n${unit.text}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "new_text",
    creativity: options.creativity,
    signal: options.signal,
  });
  const text = bullets ? bulletLines(answer.text) : answer.text.trim();
  // An English sign-off stays the tone's.
  const english = /^english$/i.test(options.language ?? extracted.language ?? "English");
  const updated = { ...unit, text: unit.id === SIGN_OFF_UNIT && english ? TONES[tone].signOff : text || unit.text };
  return {
    // The letter's recipient and greeting aren't claims about the candidate.
    data:
      options.strict && !isFrameUnit(unit.id)
        ? // The email's greeting names its recipient, from the posting or typed in by the user.
          guardUnits([updated], guardSources(profile, extracted, kind === DocumentKind.EMAIL ? [posting, emailParts(document).to].join("\n") : posting))[0]
        : { ...updated, unverified: undefined },
    promptVersion: REGENERATE_UNIT_VERSION,
  };
};
