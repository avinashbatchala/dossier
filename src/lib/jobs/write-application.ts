import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { summaryText, tailoringSummary } from "@/lib/ai/tailoring-summary";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorResume, writeCoverLetter } from "@/lib/ai/tasks";
import { calendarDay } from "@/lib/application-documents";
import { extractedOf, matchSchema, unitsSchema, type Extracted, type Unit } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import { saveVersion } from "@/lib/document-versions";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { emit } from "@/lib/notifications/notify";
import { prisma } from "@/lib/prisma";
import { loadFactTexts, loadProfile } from "@/lib/profile-data";
import { loadProfileSettings } from "@/lib/profiles";
import { withoutSectionsOff } from "@/lib/resume-sections";
import { DOCUMENTS_TO_WRITE } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { WRITE_APPLICATION_STEPS } from "./application-steps";
import { defineJob } from "./runner";

/** The key of writing a new application's documents, to find it again from its page. */
export const writeApplicationJobKey = (applicationId: string) => `writing:${applicationId}`;

/** The posting as read, with the details as the user corrected them, for the prompts. */
function corrected(application: Parameters<typeof extractedOf>[0] & { deadline: Date | null }): Extracted {
  const orNull = (value: string) => value.trim() || null;
  return {
    ...extractedOf(application),
    title: orNull(application.title),
    company: orNull(application.company),
    role: orNull(application.role),
    location: orNull(application.location),
    mode: orNull(application.mode),
    salary: orNull(application.salary),
    deadline: application.deadline ? application.deadline.toISOString().slice(0, 10) : null,
  };
}

/** Saves a document the first time it's written; one already there (a retry) stays. */
async function saveDocument(applicationId: string, kind: DocumentKind, units: Unit[], writtenWith: string, themeId: string | null): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({ data: { applicationId, kind, units, themeId, writtenWith } });
      await saveVersion(tx, document.id, units, { cause: VersionCause.WRITTEN });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return;
    throw error;
  }
}

/**
 * Writes a new application's resume and cover letter on the server (E31-4,
 * decided 17 November 2026), into the Draft New application made first, so
 * the user can leave while it writes. Each document is saved as soon as it's
 * written: Stop keeps what's there. Once both are in, the fact guard's
 * findings go into the opening message, and "Documents written" goes out.
 */
export const writeApplicationJob = defineJob({
  type: "write-application",
  input: z.object({
    applicationId: z.string().min(1),
    /** Which documents to write (#367). */
    write: z.enum(DOCUMENTS_TO_WRITE).default("both"),
  }),
  result: z.object({ applicationId: z.string() }),
  async run({ applicationId, write }, { step, signal }) {
    await step(WRITE_APPLICATION_STEPS[0]);
    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId }, include: { documents: { select: { kind: true, units: true } } } });
    const [provider, options, settings, fullProfile, own, facts] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      loadSettings(),
      loadProfile(application.profileId),
      loadProfileSettings(application.profileId),
      loadFactTexts(applicationId),
    ]);

    await step(WRITE_APPLICATION_STEPS[1]);
    // A section that's off on the base resume isn't written about (#297).
    const profile = withoutSectionsOff(fullProfile, own.resumeSections);
    const extracted = corrected(application);
    const parsed = matchSchema.safeParse(application.match);
    const match = parsed.success ? parsed.data : { items: [] };
    const posting = application.postingText;
    const taskOptions = { ...options, language: application.language || options.language, signal };
    // On a retry, what was written before stays.
    const before = (kind: DocumentKind) => {
      const document = application.documents.find((entry) => entry.kind === kind);
      const units = document ? unitsSchema.safeParse(document.units) : null;
      return units?.success ? units.data : null;
    };
    const has = (kind: DocumentKind) => application.documents.some((document) => document.kind === kind);
    let resume: Unit[] = before(DocumentKind.RESUME) ?? [];
    let letter: Unit[] = before(DocumentKind.COVER_LETTER) ?? [];

    if (write !== "letter") {
      await step(WRITE_APPLICATION_STEPS[2]);
      if (!has(DocumentKind.RESUME)) {
        // Skills in the user's own order once they set one (public issue 62).
        const written = await tailorResume(provider, { profile, extracted, match, facts, posting, keepSkillOrder: own.skillOrder === "manual" }, taskOptions);
        resume = written.data;
        await saveDocument(applicationId, DocumentKind.RESUME, resume, written.promptVersion, own.baseThemeId);
      }
    }

    if (write !== "resume") {
      await step(WRITE_APPLICATION_STEPS[3]);
      if (!has(DocumentKind.COVER_LETTER)) {
        const written = await writeCoverLetter(provider, { profile, extracted, match, tone: application.tone, facts, posting }, taskOptions);
        // E8-11: the AI wrote the recipient and greeting; the sender and signature come from the profile, and the date is today's.
        letter = withFrame(
          written.data,
          newFrame({
            basics: profile.basics,
            company: application.company,
            location: application.location,
            date: calendarDay(),
            dateFormat: settings.dateFormat,
            lang: documentLanguage(application.language, written.data.map((unit) => unit.text).join(" ")).lang,
            labels: documentLabels(application.language),
          }),
        );
        await saveDocument(applicationId, DocumentKind.COVER_LETTER, letter, written.promptVersion, own.baseThemeId);
      }
    }

    // The fact guard marked what it couldn't back as it wrote; what it found goes into the opening message.
    await step(WRITE_APPLICATION_STEPS[4]);
    const summary = tailoringSummary({
      profile: fullProfile,
      company: application.company,
      role: application.role,
      match,
      resume,
      letter,
      tone: application.tone,
      note: facts[0] ?? "",
      references: !settings.includeRefs ? "setting-off" : extracted.asksForReferences ? "included" : "not-asked",
      strict: settings.strict,
      showChanges: settings.showDiff,
    });
    if (resume.length > 0 || letter.length > 0) await prisma.chatMessage.create({ data: { applicationId, role: "AI", text: summaryText(summary) } });
    await emit("documents.written", { applicationId, title: application.role.trim() || application.title, company: application.company, resume: resume.length > 0, letter: letter.length > 0 });
    return { applicationId };
  },
});
