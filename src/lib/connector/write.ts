import "server-only";

import { z } from "zod";

import { ApplicationStatus, DocumentKind, VersionCause, type Tone } from "@/generated/prisma/enums";
import { guardSources, guardUnits, type FactSources } from "@/lib/ai/fact-guard";
import { resumeUnits } from "@/lib/ai/tasks/tailor-resume";
import { withoutFrame } from "@/lib/ai/tasks/write-cover-letter";
import { createApplicationFromDocuments } from "@/lib/application-create";
import { extractedOf, SIGN_OFF_UNIT, unitsSchema, type Extracted, type Match, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { updateDocuments } from "@/lib/document-units";
import { FRAME_LABELS, isFrameUnit, withFrame, type Frame } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { loadProfileSettings } from "@/lib/profiles";
import { sectionLayoutSchema, withoutSectionsOff } from "@/lib/resume-sections";
import { loadSettings } from "@/lib/settings-data";
import { TONES } from "@/lib/tones";

// An application written in Claude chat and saved through the connector
// (#221, save_application): Claude reads the profile and the posting, writes
// the tailored resume and cover letter itself, and Dossier keeps them as a
// Draft application, as if it had written them. So Dossier needs no AI model
// of its own for this. The parts are checked like the AI's: roles, projects
// and degrees must be the profile's, skills its own skills, certifications,
// publications and custom sections come from the profile word for word, and with "Never invent experience" on,
// names and numbers the profile and posting don't back are marked "check this".
// A Draft saved this way can be revised the same way (public issue 116,
// update_application), rather than saved again as a second application.

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
  /** The profile it was written from (E24-6); the first when it's missing. */
  profileId?: string;
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
function letterUnits(letter: z.output<typeof writtenLetterSchema>, signOff: string): Unit[] {
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

/** The tone's sign-off for a letter in English or without its own, else the letter's. */
function signOffFor(letter: z.output<typeof writtenLetterSchema>, tone: Tone, language: string): string {
  const english = /^english$/i.test(language.trim() || "English");
  return english || !letter.sign_off.trim() ? TONES[tone].signOff : letter.sign_off.trim();
}

/** The units with names and numbers `sources` don't back marked; the recipient and greeting aren't claims about the candidate. */
function checked(units: Unit[], sources: FactSources): Unit[] {
  return guardUnits(units, sources).map((unit) => (isFrameUnit(unit.id) ? units.find((entry) => entry.id === unit.id)! : unit));
}

const unverifiedOf = (units: Unit[]) => units.filter((unit) => unit.unverified?.length).map((unit) => ({ part: unit.label, items: unit.unverified! }));

const matchOf = (items: z.output<typeof writtenMatchSchema>): Match => ({
  items: items.map((item) => ({ requirement: item.requirement, result: item.result, skill: null, experienceIds: [], note: item.note })),
});

/** Saves an application Claude wrote; returns its id and the parts marked "check this". */
export async function saveWrittenApplication(input: WrittenApplication): Promise<{ applicationId: string; unverified: { part: string; items: string[] }[] }> {
  const [fullProfile, settings, own] = await Promise.all([loadProfile(input.profileId), loadSettings(), loadProfileSettings(input.profileId)]);
  // A section that's off on the base resume isn't on it (#297).
  const profile = withoutSectionsOff(fullProfile, own.resumeSections);
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
  const match = matchOf(input.match);

  const tone = settings.defaultTone;
  let resume = resumeUnits(profile, input.resume, documentLabels(details.language));
  let letter = letterUnits(input.letter, signOffFor(input.letter, tone, details.language));
  if (settings.strict) {
    const facts = input.note.trim() ? [input.note.trim()] : [];
    const sources = guardSources(profile, extracted, input.posting, facts);
    resume = checked(resume, sources);
    letter = checked(letter, sources);
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
    profileId: input.profileId,
  });
  return { applicationId, unverified: unverifiedOf([...resume, ...letter]) };
}

export type WrittenRevision = {
  resume?: z.output<typeof writtenResumeSchema>;
  letter?: z.output<typeof writtenLetterSchema>;
  match?: z.output<typeof writtenMatchSchema>;
  /** What the user asked to change, for the documents' version history. */
  change: string;
};

/**
 * Replaces the resume, the cover letter or the match of a Draft, checked as
 * saveWrittenApplication checks them. A sent application keeps the resume it
 * was sent with (#299), so only a Draft changes. Each changed document gets a
 * version, as a change from the refine chat does.
 */
export async function reviseWrittenApplication(
  applicationId: string,
  revision: WrittenRevision,
): Promise<{ error: string } | { unverified: { part: string; items: string[] }[] }> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId, awaitingReview: false },
    select: {
      status: true,
      tone: true,
      language: true,
      sections: true,
      postingText: true,
      extracted: true,
      title: true,
      company: true,
      role: true,
      location: true,
      mode: true,
      salary: true,
      profileId: true,
      documents: { select: { kind: true } },
    },
  });
  if (!application) return { error: "That application no longer exists." };
  if (application.status !== ApplicationStatus.DRAFT) return { error: "Only a Draft can be changed: this application was sent, and keeps what it was sent with." };
  const has = (kind: DocumentKind) => application.documents.some((document) => document.kind === kind);
  if (revision.resume && !has(DocumentKind.RESUME)) return { error: "This application has no tailored resume. The user can write one from the application in Dossier." };
  if (revision.letter && !has(DocumentKind.COVER_LETTER)) return { error: "This application has no cover letter. The user can write one from the application in Dossier." };

  // The application's own profile (E24), with its own sections when it has them, or its base resume's (#297).
  const [fullProfile, settings, own, facts] = await Promise.all([
    loadProfile(application.profileId),
    loadSettings(),
    loadProfileSettings(application.profileId),
    loadFactTexts(applicationId),
  ]);
  const sections = sectionLayoutSchema.safeParse(application.sections);
  const profile = withoutSectionsOff(fullProfile, sections.success ? sections.data : own.resumeSections);
  const language = application.language || "English";
  let resume = revision.resume ? resumeUnits(profile, revision.resume, documentLabels(language)) : null;
  let letter = revision.letter ? letterUnits(revision.letter, signOffFor(revision.letter, application.tone, language)) : null;
  if (settings.strict) {
    const sources = guardSources(profile, extractedOf(application), application.postingText, facts);
    if (resume) resume = checked(resume, sources);
    if (letter) letter = checked(letter, sources);
  }

  await updateDocuments(
    applicationId,
    async (documents, tx) => {
      if (resume) documents.RESUME = resume;
      if (letter && documents.COVER_LETTER) {
        // The sender, date and signature stay, and the recipient and greeting when none was written.
        const frame: Partial<Frame> = Object.fromEntries(documents.COVER_LETTER.filter((unit) => isFrameUnit(unit.id)).map((unit) => [unit.id, unit.text]));
        documents.COVER_LETTER = withFrame(letter, frame);
      }
      if (revision.match) await tx.application.update({ where: { id: applicationId }, data: { match: matchOf(revision.match), matchedWith: WRITTEN_IN_CLAUDE } });
    },
    { version: { cause: VersionCause.REFINED, detail: revision.change } },
  );
  return { unverified: unverifiedOf([...(resume ?? []), ...(letter ?? [])]) };
}
