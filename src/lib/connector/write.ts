import "server-only";

import { z } from "zod";

import { guardSources, guardUnits } from "@/lib/ai/fact-guard";
import { resumeUnits } from "@/lib/ai/tasks/tailor-resume";
import { withoutFrame } from "@/lib/ai/tasks/write-cover-letter";
import { createApplicationFromDocuments } from "@/lib/application-create";
import { SIGN_OFF_UNIT, unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { FRAME_LABELS, isFrameUnit } from "@/lib/letter-frame";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { TONES } from "@/lib/tones";

// An application written in Claude chat and saved through the connector
// (#221, save_application): Claude reads the profile and the posting, writes
// the tailored resume and cover letter itself, and Dossier keeps them as a
// Draft application, as if it had written them. So Dossier needs no AI model
// of its own for this. The parts are checked like the AI's: roles, projects
// and degrees must be the profile's, skills its own skills, publications come
// from the profile word for word, and with "Never invent experience" on,
// names and numbers the profile and posting don't back are marked "check this".

/** Shown as what wrote the documents, where Dossier would show a prompt version. */
export const WRITTEN_IN_CLAUDE = "claude-chat";

export const writtenResumeSchema = z.object({
  summary: z.string().max(2000).describe("2–3 sentences about the candidate as this job would see them"),
  roles: z
    .array(z.object({ id: z.string(), bullets: z.array(z.string().max(400)).max(8) }))
    .describe("Every role from get_profile by its id, with 2–5 tailored bullets; a role left out keeps its own bullets"),
  projects: z.array(z.object({ id: z.string(), bullets: z.array(z.string().max(400)).max(6) })).default([]),
  skills: z.array(z.string().max(100)).describe("The profile's own skills, most relevant first; others are dropped"),
  education: z.array(z.object({ id: z.string(), notes: z.string().max(600) })).default([]),
});

export const writtenLetterSchema = z.object({
  recipient: z.string().max(400).default("").describe("Address block, one line per line, e.g. 'Acme · Hiring team\\nBerlin'"),
  greeting: z.string().max(200).default("").describe("e.g. 'Dear Acme team,'"),
  paragraphs: z
    .array(z.object({ label: z.string().max(60).default(""), text: z.string().min(1).max(3000) }))
    .min(1)
    .max(6)
    .describe("3–4 paragraphs, about 200–300 words together, without greeting, sign-off or name"),
  sign_off: z.string().max(60).default("").describe("e.g. 'Warm regards,'; empty uses the tone's own"),
});

export const writtenDetailsSchema = z.object({
  company: z.string().max(300),
  role: z.string().max(300),
  title: z.string().max(500).optional(),
  location: z.string().max(300).default(""),
  mode: z.string().max(100).default("").describe("e.g. Remote, Hybrid, On-site"),
  salary: z.string().max(200).default(""),
  deadline: z.iso.date().nullable().default(null),
  language: z.string().max(60).default("English").describe("The language the documents are written in"),
});

export const writtenMatchSchema = z
  .array(
    z.object({
      requirement: z.string().max(300),
      result: z.enum(["covered", "partial", "gap"]),
      note: z.string().max(300).nullable().default(null),
    }),
  )
  .max(30)
  .default([]);

export type WrittenApplication = {
  posting: string;
  postingUrl: string;
  postingId: string | null;
  details: z.output<typeof writtenDetailsSchema>;
  resume: z.output<typeof writtenResumeSchema>;
  letter: z.output<typeof writtenLetterSchema>;
  match: z.output<typeof writtenMatchSchema>;
  note: string;
};

/** The cover letter's parts, as the AI's are made (src/lib/ai/tasks/write-cover-letter.ts). */
export function letterUnits(letter: z.output<typeof writtenLetterSchema>, signOff: string): Unit[] {
  const tidy = (text: string) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  return unitsSchema.parse([
    ...(letter.recipient.trim() ? [{ id: "recipient", label: FRAME_LABELS.recipient, text: tidy(letter.recipient) }] : []),
    ...(letter.greeting.trim() ? [{ id: "greeting", label: FRAME_LABELS.greeting, text: letter.greeting.trim() }] : []),
    ...withoutFrame(letter.paragraphs, signOff)
      .filter((paragraph) => paragraph.text.trim())
      .map((paragraph, index) => ({ id: `paragraph:${index + 1}`, label: paragraph.label.trim() || `Paragraph ${index + 1}`, text: paragraph.text.trim() })),
    { id: SIGN_OFF_UNIT, label: "Sign-off", text: signOff },
  ]);
}

/** Saves an application Claude wrote; returns its id and the parts marked "check this". */
export async function saveWrittenApplication(input: WrittenApplication): Promise<{ applicationId: string; unverified: { part: string; items: string[] }[] }> {
  const [profile, settings] = await Promise.all([loadProfile(), loadSettings()]);
  const { details } = input;
  const extracted: Extracted = {
    title: details.title?.trim() || null,
    company: details.company.trim() || null,
    role: details.role.trim() || null,
    location: details.location.trim() || null,
    mode: details.mode.trim() || null,
    salary: details.salary.trim() || null,
    deadline: details.deadline,
    requirements: input.match.map((item) => ({ text: item.requirement, kind: "other", skill: null, years: null, language: null })),
    asksForReferences: false,
    language: details.language.trim() || null,
  };
  const match: Match = { items: input.match.map((item) => ({ requirement: item.requirement, result: item.result, skill: null, experienceIds: [], note: item.note })) };

  const tone = settings.defaultTone;
  const english = /^english$/i.test(details.language.trim() || "English");
  const signOff = english || !input.letter.sign_off.trim() ? TONES[tone].signOff : input.letter.sign_off.trim();
  let resume = resumeUnits(profile, input.resume, documentLabels(details.language));
  let letter = letterUnits(input.letter, signOff);
  if (settings.strict) {
    const facts = input.note.trim() ? [input.note.trim()] : [];
    const sources = guardSources(profile, extracted, input.posting, facts);
    resume = guardUnits(resume, sources);
    // The recipient and greeting aren't claims about the candidate: only the paragraphs are checked.
    letter = guardUnits(letter, sources).map((unit) => (isFrameUnit(unit.id) ? letter.find((entry) => entry.id === unit.id)! : unit));
  }

  const applicationId = await createApplicationFromDocuments({
    reading: { posting: input.posting, extracted, extractedWith: WRITTEN_IN_CLAUDE, matchedWith: WRITTEN_IN_CLAUDE },
    documents: { resume, resumeWith: WRITTEN_IN_CLAUDE, letter, letterWith: WRITTEN_IN_CLAUDE },
    match,
    details: {
      title: details.title?.trim() || [details.role, details.company].filter((part) => part.trim()).join(" · "),
      company: details.company.trim(),
      role: details.role.trim(),
      location: details.location.trim(),
      mode: details.mode.trim(),
      salary: details.salary.trim(),
      deadline: details.deadline ?? "",
    },
    postingUrl: input.postingUrl,
    tone,
    note: input.note,
    claim: { kind: "connector", postingId: input.postingId },
  });
  const unverified = [...resume, ...letter].filter((unit) => unit.unverified?.length).map((unit) => ({ part: unit.label, items: unit.unverified! }));
  return { applicationId, unverified };
}
