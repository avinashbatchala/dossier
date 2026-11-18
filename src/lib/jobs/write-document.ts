import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorResume, writeCoverLetter } from "@/lib/ai/tasks";
import { calendarDay } from "@/lib/application-documents";
import { extractedOf, matchSchema, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import { updateDocuments } from "@/lib/document-units";
import { saveVersion } from "@/lib/document-versions";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { sectionLayoutSchema, withoutSectionsOff } from "@/lib/resume-sections";
import { loadProfileSettings } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { TONES } from "@/lib/tones";

import { defineJob } from "./runner";

/** The key of writing an application's missing document, to find it again after a reload. */
export const writeDocumentJobKey = (applicationId: string, kind: WritableKind) => `document:${applicationId}:${kind}`;

const WRITABLE = [DocumentKind.RESUME, DocumentKind.COVER_LETTER] as const;
export type WritableKind = (typeof WRITABLE)[number];

/**
 * Writes the tailored resume or cover letter an application was created
 * without (#367), from what it was written for: the posting as read and
 * corrected, the match, the tone and its facts. With `rewrite`, it writes
 * the letter again over the one there, e.g. in another tone or language
 * (E30-9, AP3), and keeps the old one as a version.
 */
export const writeDocumentJob = defineJob({
  type: "write-document",
  input: z.object({ applicationId: z.string().min(1), kind: z.enum(WRITABLE), rewrite: z.boolean().optional() }),
  result: z.object({ applicationId: z.string() }),
  async run({ applicationId, kind, rewrite = false }, { step, signal }) {
    await step(kind === DocumentKind.RESUME ? "Tailoring your resume" : "Writing your cover letter");
    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: { select: { kind: true } } } });
    const written = application.documents.some((document) => document.kind === kind);
    if (written && !rewrite) return { applicationId };

    const [provider, options, fullProfile, settings, facts] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      loadProfile(application.profileId),
      loadSettings(),
      loadFactTexts(applicationId),
    ]);
    const own = await loadProfileSettings(application.profileId);
    // Its own sections when it has them, or the base resume's (#297).
    const sections = sectionLayoutSchema.safeParse(application.sections);
    const profile = withoutSectionsOff(fullProfile, sections.success ? sections.data : own.resumeSections);
    const extracted = extractedOf(application);
    const parsedMatch = matchSchema.safeParse(application.match);
    const match = parsedMatch.success ? parsedMatch.data : { items: [] };
    const posting = application.postingText;
    // In the language of the document it goes with.
    const taskOptions = { ...options, language: application.language || options.language, signal };

    let units: Unit[];
    let writtenWith: string;
    if (kind === DocumentKind.RESUME) {
      const resume = await tailorResume(provider, { profile, extracted, match, facts, posting, keepSkillOrder: own.skillOrder === "manual" }, taskOptions);
      units = resume.data;
      writtenWith = resume.promptVersion;
    } else {
      const letter = await writeCoverLetter(provider, { profile, extracted, match, tone: application.tone, facts, posting }, taskOptions);
      const language = application.language || settings.docLanguage || extracted.language || "English";
      // The sender and signature from the profile, and today's date, as a new application's letter has (E8-11).
      units = withFrame(
        letter.data,
        newFrame({
          basics: profile.basics,
          company: application.company,
          location: application.location,
          date: calendarDay(),
          dateFormat: settings.dateFormat,
          lang: documentLanguage(language, letter.data.map((unit) => unit.text).join(" ")).lang,
          labels: documentLabels(language),
        }),
      );
      writtenWith = letter.promptVersion;
    }

    if (written) {
      // Over the one there, which stays in the history.
      const detail = kind === DocumentKind.RESUME ? "the whole resume" : `the letter, in ${application.language || "English"} and a ${TONES[application.tone].label.toLowerCase()} tone`;
      await updateDocuments(
        applicationId,
        async (documents) => {
          documents[kind] = units;
        },
        { version: { cause: VersionCause.REGENERATED, detail } },
      );
      // After, since updateDocuments checks the document wasn't changed meanwhile.
      await prisma.document.update({ where: { applicationId_kind: { applicationId, kind } }, data: { writtenWith } });
      return { applicationId };
    }

    try {
      await prisma.$transaction(async (tx) => {
        const document = await tx.document.create({ data: { applicationId, kind, units, themeId: own.baseThemeId, writtenWith } });
        await saveVersion(tx, document.id, units, { cause: VersionCause.WRITTEN });
      });
    } catch (error) {
      // Written meanwhile, by another click: that one stays.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { applicationId };
      throw error;
    }
    return { applicationId };
  },
});
