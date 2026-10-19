import "server-only";

import { ApplicationOrigin, type Tone } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { summaryText, tailoringSummary } from "@/lib/ai/tailoring-summary";
import { calendarDay } from "@/lib/application-documents";
import type { ReadPostingResult } from "@/lib/jobs/read-posting";
import type { WriteDocumentsResult } from "@/lib/jobs/write-documents";
import { documentLanguage } from "@/lib/document-language";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { logServerError } from "@/lib/log";
import { describeTrim, fitResumeToOnePage } from "@/lib/one-page";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";

// Creating an application from finished documents (E7-6), shared by New
// application and the job agent (E16). The caller has the reading and the
// documents; this writes the Draft application, its resume and cover letter
// in the base theme, and the opening chat message in one transaction.

export type ApplicationDetails = {
  title: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  salary: string;
  /** "2026-10-15", or "" when there's no deadline. */
  deadline: string;
};

export type ApplicationReading = {
  input: { posting: string };
  result: ReadPostingResult;
};

export type ApplicationClaim =
  | { kind: "manual"; writeJobId: string; readJobId: string }
  | { kind: "agent"; candidateId: string; jobId: string; score: number };

export type CreateApplicationInput = {
  reading: ApplicationReading;
  documents: WriteDocumentsResult;
  details: ApplicationDetails;
  /** A safe http(s) link, or "". */
  postingUrl: string;
  postingId?: string | null;
  tone: Tone;
  note: string;
  claim: ApplicationClaim;
};

/** Creates the application once, or returns the one an earlier click made. */
export async function createApplicationFromDocuments({
  reading,
  documents,
  details,
  postingUrl,
  postingId = null,
  tone,
  note,
  claim,
}: CreateApplicationInput): Promise<string> {
  const [settings, profile] = await Promise.all([loadSettings(), loadProfile()]);
  const { extracted, extractedWith, matchedWith } = reading.result;
  const match = reading.result.match;
  const language = settings.docLanguage ?? extracted.language ?? "English";

  // E8-11: every part of the letter is a unit. The AI wrote the recipient and
  // greeting; the sender and signature come from the profile, and the date is
  // written now, in the letter's language.
  const letter = withFrame(
    documents.letter,
    newFrame({
      basics: profile.basics,
      company: details.company,
      location: details.location,
      date: calendarDay(),
      dateFormat: settings.dateFormat,
      lang: documentLanguage(language, documents.letter.map((unit) => unit.text).join(" ")).lang,
    }),
  );
  const summary = tailoringSummary({
    profile,
    company: details.company,
    role: details.role,
    match,
    resume: documents.resume,
    letter: documents.letter,
    tone,
    note,
    references: !settings.includeRefs ? "setting-off" : extracted.asksForReferences ? "included" : "not-asked",
    strict: settings.strict,
    showChanges: settings.showDiff,
  });

  const created = await prisma.$transaction(async (tx) => {
    if (claim.kind === "manual") {
      // Claim the job first: a second click waits here, then finds it taken.
      const { count } = await tx.job.updateMany({ where: { id: claim.writeJobId, key: null }, data: { key: "application:pending" } });
      if (count === 0) {
        const claimed = await tx.job.findUniqueOrThrow({ where: { id: claim.writeJobId }, select: { key: true } });
        if (claimed.key?.startsWith("application:") && claimed.key !== "application:pending") {
          return { id: claimed.key.slice("application:".length), isNew: false };
        }
        throw new ActionError("This application is already being created.");
      }
    } else {
      // The agent claimed the candidate before it wrote anything; a second
      // run must not make a second application for it.
      const { count } = await tx.agentCandidate.updateMany({
        where: { id: claim.candidateId, status: "DRAFTING" },
        data: { status: "DRAFTED", error: null },
      });
      if (count === 0) throw new ActionError("This draft is no longer waiting to be created.");
    }

    const application = await tx.application.create({
      data: {
        ...(claim.kind === "agent" ? { origin: ApplicationOrigin.AGENT, agentScore: claim.score, agentJobId: claim.jobId } : {}),
        title: details.title || [details.role, details.company].filter(Boolean).join(" · ") || "Untitled application",
        company: details.company,
        role: details.role,
        location: details.location,
        mode: details.mode,
        salary: details.salary,
        deadline: details.deadline ? new Date(`${details.deadline}T00:00:00Z`) : null,
        postingUrl,
        postingText: reading.input.posting,
        extracted,
        extractedWith,
        match,
        matchedWith,
        tone,
        userNote: note,
        language,
        documents: {
          create: [
            // Each starts its history with the first draft (E8-10).
            {
              kind: "RESUME",
              units: documents.resume,
              themeId: settings.baseThemeId,
              writtenWith: documents.resumeWith,
              versions: { create: { units: documents.resume, cause: "WRITTEN" } },
            },
            {
              kind: "COVER_LETTER",
              units: letter,
              themeId: settings.baseThemeId,
              writtenWith: documents.letterWith,
              versions: { create: { units: letter, cause: "WRITTEN" } },
            },
          ],
        },
        messages: { create: { role: "AI", text: summaryText(summary) } },
      },
      select: { id: true },
    });

    if (claim.kind === "manual") {
      await tx.job.updateMany({
        where: { id: { in: [claim.writeJobId, claim.readJobId] } },
        data: { key: `application:${application.id}`, applicationId: application.id },
      });
    } else {
      await tx.agentCandidate.update({ where: { id: claim.candidateId }, data: { applicationId: application.id } });
    }
    // The posting it came from shows it as applied for (E14-8); one already linked keeps its application.
    if (postingId) await tx.posting.updateMany({ where: { id: postingId, applicationId: null }, data: { applicationId: application.id } });
    return { id: application.id, isNew: true };
  });

  // E10-10: once created, a resume that runs over is trimmed to one page,
  // and the opening message says what was cut. A failure here leaves the
  // resume as written rather than failing the application.
  if (settings.onePage) {
    try {
      const { trimmed, fits } = await fitResumeToOnePage(created.id, profile);
      if (trimmed.length > 0 && settings.showDiff) {
        const text = summaryText({ ...summary, list: [...summary.list, ...describeTrim(trimmed, profile, fits)] });
        await prisma.chatMessage.updateMany({ where: { applicationId: created.id, role: "AI", writtenWith: null }, data: { text } });
      }
    } catch (error) {
      logServerError("one-page trimming", error);
    }
  }
  return created.id;
}
