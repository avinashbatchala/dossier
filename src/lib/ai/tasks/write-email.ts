import { z } from "zod";

import type { Tone } from "@/generated/prisma/enums";
import type { Extracted, Match, Unit } from "@/lib/application-data";
import { emailUnits, isEmailAddress } from "@/lib/application-email";
import type { ProfileData } from "@/lib/profile";
import { TONES } from "@/lib/tones";

import { guardSources, guardUnits } from "../fact-guard";

import {
  applicationFacts,
  candidateFacts,
  CREATIVITY,
  jobForPrompt,
  languageRule,
  NO_EM_DASHES,
  postingForPrompt,
  profileForPrompt,
  system,
  truthfulness,
  UNTRUSTED_POSTING,
  type Task,
} from "./prompt-parts";
import { withoutFrame } from "./write-cover-letter";

export const WRITE_EMAIL_VERSION = "write-email@2";

const answerSchema = z.object({
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  subject: z.string(),
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  signOff: z.string(),
});

const INSTRUCTIONS = `You write the email a candidate sends their job application with, as JSON. The resume and the cover letter are attached to it, so the email doesn't repeat them: it's a short, friendly note that gets them opened.

- contactName and contactEmail: the person and the email address the posting says to send applications to, exactly as the posting writes them. Use null for anything the posting doesn't give; never guess an address.
- subject: a clear subject line with the role and the candidate's name, e.g. "Application: Senior Product Designer, Jane Doe". If the posting asks for a reference number or a particular subject line, use that.
- greeting: the salutation, usual for an email in its language, with its punctuation: the contact person by name when the posting names one, else the hiring team, e.g. "Dear Ledgerly team,".
- paragraphs: two or three short paragraphs, about 80–150 words together: the role the candidate is applying for, the one or two things that make them a strong fit for it (not a summary of the resume or the letter), that the resume and cover letter are attached, and that they'd be glad to talk. No greeting, sign-off or name in them: those are separate.
- signOff: the closing line before the name, matching the tone, with its punctuation (e.g. "Warm regards,").
- The candidate's name is added after the sign-off; don't write it.`;

export type EmailInput = {
  profile: ProfileData;
  extracted: Extracted;
  match: Match | null;
  tone: Tone;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
  /** The posting as pasted: where to send the application, and for the fact guard. */
  posting: string;
  /** The cover letter's paragraphs, so the email doesn't repeat them. */
  letter: string[];
};

/**
 * The application's email (its Email tab): the recipient the posting names,
 * a subject and the message, as the units "to", "subject" and "body". The
 * message ends with the sign-off and the candidate's name. An address the
 * posting doesn't contain is never used, so the recipient may be empty.
 */
export const writeEmail: Task<EmailInput, Unit[]> = async (provider, { profile, extracted, match, tone, facts, posting, letter }, options) => {
  const answer = await provider.complete({
    system: system(
      INSTRUCTIONS,
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
          letter.length > 0 && `The cover letter it goes with:\n${letter.join("\n\n")}`,
          applicationFacts(facts),
          `The posting, for who to send it to and how:\n${postingForPrompt(posting)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "application_email",
    creativity: options.creativity,
    signal: options.signal,
  });

  // English emails get the tone's own sign-off, as letters do; other languages keep the model's.
  const language = options.language ?? extracted.language ?? "English";
  const signOff = /^english$/i.test(language) || !answer.signOff.trim() ? TONES[tone].signOff : answer.signOff.trim();
  const paragraphs = withoutFrame(answer.paragraphs.map((text) => ({ text })), signOff)
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean);
  const body = [answer.greeting.trim(), ...paragraphs, [signOff, profile.basics.name.trim()].filter(Boolean).join("\n")]
    .filter(Boolean)
    .join("\n\n");

  const [to, ...written] = emailUnits({ to: recipient(answer.contactName, answer.contactEmail, posting), subject: oneLine(answer.subject), body });
  return {
    // The recipient comes from the posting; the subject and message are checked like the letter's paragraphs.
    data: [to, ...(options.strict ? guardUnits(written, guardSources(profile, extracted, posting, facts)) : written)],
    promptVersion: WRITE_EMAIL_VERSION,
  };
};

/**
 * "John Doe <john@example.com>", or just the address. Empty unless the
 * posting has the address, so a guessed one is never used.
 */
export function recipient(name: string | null, address: string | null, posting: string): string {
  const email = address?.trim().replace(/^mailto:/i, "") ?? "";
  if (!isEmailAddress(email) || !posting.toLowerCase().includes(email.toLowerCase())) return "";
  const who = oneLine(name ?? "").replace(/[<>"]/g, "");
  return who && who.toLowerCase() !== email.toLowerCase() ? `${who} <${email}>` : email;
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
