import { z } from "zod";

import type { Extracted } from "@/lib/application-data";
import type { MessageKind } from "@/lib/message-draft";
import type { ProfileData } from "@/lib/profile";

import { applicationFacts, jobForPrompt, languageRule, NO_EM_DASHES, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

const WRITE_MESSAGE_VERSION = "write-message@1";

// A short message drafted on a click (E30-7, E30-8, U3): a follow-up for an
// application that has gone quiet, or an answer to an offer. Never sent
// without the user.

const answerSchema = z.object({ subject: z.string(), body: z.string() });

const WHAT: Record<MessageKind, string> = {
  "follow-up":
    "A short, friendly follow-up on an application that has had no answer: say when it was sent and for which role, restate in one sentence why the candidate fits, and ask whether there's news. No pressure, no apology for writing.",
  accept: "An acceptance of the job offer: warm and brief, thank them, and confirm the start date if the offer gives one.",
  more: "An answer to the job offer that asks politely whether there's room on the salary: keen on the role, grounded in the posted range and what the candidate brings. Never threaten or invent other offers.",
  decline: "A polite, warm decline of the job offer: thank them for their time and leave the door open, without a long explanation.",
};

const INSTRUCTIONS = `You write one short email a job candidate will send about an application, as JSON.

- subject: the email's subject line.
- body: the whole message, from the greeting to the sign-off and the candidate's name, under 150 words, plain text with blank lines between paragraphs.
- Use only what's given: never invent experience, numbers, names or other offers.`;

export type MessageInput = {
  kind: MessageKind;
  /** The candidate's name, for the sign-off. */
  name: string;
  profile: ProfileData;
  extracted: Extracted;
  /** When it was sent, e.g. "Mon 2 Nov", for a follow-up. */
  sent: string | null;
  /** The offer as kept (E30-7), and the posting's own salary. */
  offer: { salary: string; startDate: string | null; postedSalary: string } | null;
  /** What the candidate tells the AI for this application (APP-15). */
  facts: string[];
};

/** E30-7, E30-8: the message's subject and body. */
export const writeMessage: Task<MessageInput, { subject: string; body: string }> = async (provider, { kind, name, profile, extracted, sent, offer, facts }, options) => {
  const answer = await provider.complete({
    task: "write-message",
    system: system(INSTRUCTIONS, `What to write: ${WHAT[kind]}`, languageRule(options.language), UNTRUSTED_POSTING, NO_EM_DASHES),
    messages: [
      {
        role: "user",
        content: [
          `The candidate: ${name || "the candidate"}${profile.basics.headline ? `, ${profile.basics.headline}` : ""}.${profile.basics.summary ? ` ${profile.basics.summary}` : ""}`,
          `The job:\n${jobForPrompt(extracted, null)}`,
          sent && `The application was sent ${sent}.`,
          offer && `The offer: ${[offer.salary && `salary ${offer.salary}`, offer.startDate && `starting ${offer.startDate}`].filter(Boolean).join(", ") || "no details kept"}. The posting said: ${offer.postedSalary || "no salary"}.`,
          applicationFacts(facts),
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: answerSchema,
    schemaName: "message",
    creativity: options.creativity,
    signal: options.signal,
  });
  return { data: { subject: answer.subject.trim(), body: answer.body.trim() }, promptVersion: WRITE_MESSAGE_VERSION };
};
