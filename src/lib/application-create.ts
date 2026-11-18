import "server-only";

import { AgentCandidateStatus, ApplicationOrigin, ApplicationStatus, type Tone } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { summaryText, tailoringSummary } from "@/lib/ai/tailoring-summary";
import { calendarDay } from "@/lib/application-documents";
import type { Extracted, Match } from "@/lib/application-data";
import { documentLabels } from "@/lib/document-labels";
import { documentLanguage } from "@/lib/document-language";
import type { WriteDocumentsResult } from "@/lib/jobs/write-documents";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadProfileSettings, profileIdOr } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

// Creating an application from finished documents (E7-6), shared by New
// application and the job agent (E16-5): the Draft application, its resume
// and cover letter in the base theme, and the opening chat message, in one
// transaction. Nothing is trimmed to a page limit any more (#234).

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

/** What was read from the posting, as the read-posting job left it. */
type ApplicationReading = {
  posting: string;
  extracted: Extracted;
  extractedWith: string;
  matchedWith: string;
};

/**
 * Who's creating it, and the claim that stops a second click, a retry or a
 * second run from making two applications: the write-documents job for New
 * application, the candidate (DRAFTING → DRAFTED) for the agent. Claude chat
 * saves through the connector (#221), where one call makes one application.
 */
type ApplicationClaim =
  | { kind: "manual"; writeJobId: string; readJobId: string; postingId: string | null; startupId?: string | null }
  | { kind: "agent"; candidateId: string; score: number }
  | { kind: "connector"; postingId: string | null };

export type CreateApplicationInput = {
  reading: ApplicationReading;
  documents: WriteDocumentsResult;
  /** The match as shown, which the documents were written from. */
  match: Match;
  details: ApplicationDetails;
  /** A checked http(s) link, or "". */
  postingUrl: string;
  tone: Tone;
  note: string;
  claim: ApplicationClaim;
  /** The profile it's made from (E24-6), which it remembers; the first when it's not given. */
  profileId?: string | null;
};

const CLAIMED = "application:";

/** Creates the application once; creating again with the same claim returns the one that exists. */
export async function createApplicationFromDocuments({ reading, documents, match, details, postingUrl, tone, note, claim, profileId: asked }: CreateApplicationInput): Promise<string> {
  const profileId = await profileIdOr(asked);
  const [settings, profile, own] = await Promise.all([loadSettings(), loadProfile(profileId), loadProfileSettings(profileId)]);
  const { extracted, extractedWith, matchedWith } = reading;
  const language = settings.docLanguage ?? extracted.language ?? "English";
  // E8-11: every part of the letter is a unit. The AI wrote the recipient
  // and greeting; the sender and signature come from the profile, and the
  // date is written now, in the letter's language.
  const letter = withFrame(
    documents.letter,
    newFrame({
      basics: profile.basics,
      company: details.company,
      location: details.location,
      date: calendarDay(),
      dateFormat: settings.dateFormat,
      lang: documentLanguage(language, documents.letter.map((unit) => unit.text).join(" ")).lang,
      labels: documentLabels(language),
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
      const { count } = await tx.job.updateMany({ where: { id: claim.writeJobId, key: null }, data: { key: `${CLAIMED}pending` } });
      if (count === 0) {
        const claimed = await tx.job.findUniqueOrThrow({ where: { id: claim.writeJobId }, select: { key: true } });
        if (claimed.key?.startsWith(CLAIMED) && claimed.key !== `${CLAIMED}pending`) return { id: claimed.key.slice(CLAIMED.length), isNew: false };
        throw new ActionError("This application is already being created.");
      }
    } else if (claim.kind === "agent") {
      // The agent claimed the candidate before it wrote anything; only that claim may create its draft.
      const { count } = await tx.agentCandidate.updateMany({
        where: { id: claim.candidateId, status: AgentCandidateStatus.DRAFTING },
        data: { status: AgentCandidateStatus.DRAFTED, error: null },
      });
      if (count === 0) throw new ActionError("That posting is no longer waiting for a draft.");
    }

    const application = await tx.application.create({
      data: {
        profileId,
        // An agent draft stays on the Agent screen until it's approved (#195).
        ...(claim.kind === "agent" ? { origin: ApplicationOrigin.AGENT, agentScore: claim.score, awaitingReview: true } : {}),
        title: details.title || [details.role, details.company].filter(Boolean).join(" · ") || "Untitled application",
        company: details.company,
        role: details.role,
        location: details.location,
        mode: details.mode,
        salary: details.salary,
        deadline: details.deadline ? new Date(`${details.deadline}T00:00:00Z`) : null,
        postingUrl,
        postingText: reading.posting,
        extracted,
        extractedWith,
        match,
        matchedWith,
        tone,
        // "Anything I should know?" becomes the application's first fact (APP-15).
        ...(note.trim() ? { facts: { create: { text: note.trim() } } } : {}),
        language,
        documents: {
          // Each starts its history with the first draft (E8-10). One that wasn't
          // asked for isn't there, and can be written from the application (#367).
          create: [
            ...(documents.resumeWith
              ? [
                  {
                    kind: "RESUME" as const,
                    units: documents.resume,
                    themeId: own.baseThemeId,
                    writtenWith: documents.resumeWith,
                    versions: { create: { units: documents.resume, cause: "WRITTEN" as const } },
                  },
                ]
              : []),
            ...(documents.letterWith
              ? [
                  {
                    kind: "COVER_LETTER" as const,
                    units: letter,
                    themeId: own.baseThemeId,
                    writtenWith: documents.letterWith,
                    versions: { create: { units: letter, cause: "WRITTEN" as const } },
                  },
                ]
              : []),
          ],
        },
        messages: { create: { role: "AI", text: summaryText(summary) } },
      },
      select: { id: true },
    });

    if (claim.kind === "manual") {
      const key = `${CLAIMED}${application.id}`;
      await tx.job.updateMany({ where: { id: { in: [claim.writeJobId, claim.readJobId] } }, data: { key, applicationId: application.id } });
      // The posting it came from shows it as applied for (E14-8); one already linked keeps its application.
      if (claim.postingId) {
        await tx.posting.updateMany({ where: { id: claim.postingId, applicationId: null }, data: { applicationId: application.id, archivedAt: null } });
      }
      // The startup it was written to (#222): it counts as contacted once the application is sent.
      if (claim.startupId) {
        await tx.startup.updateMany({ where: { id: claim.startupId, applicationId: null }, data: { applicationId: application.id } });
      }
    } else if (claim.kind === "agent") {
      await tx.agentCandidate.update({ where: { id: claim.candidateId }, data: { applicationId: application.id } });
    } else if (claim.postingId) {
      await tx.posting.updateMany({ where: { id: claim.postingId, applicationId: null }, data: { applicationId: application.id, archivedAt: null } });
    }
    return { id: application.id, isNew: true };
  });
  return created.id;
}

export type DraftApplicationInput = {
  reading: ApplicationReading;
  /** The finished job that read the posting: claiming it stops a second click from making two. */
  readJobId: string;
  /** The match as shown, with skills added to the profile since. */
  match: Match;
  details: ApplicationDetails;
  /** A checked http(s) link, or "". */
  postingUrl: string;
  tone: Tone;
  /** "Anything I should know?": the application's first fact (APP-15). */
  note: string;
  /** The documents' language; "" for Settings', else the posting's. */
  language: string;
  /** Requirements marked "I don't have this" before writing (E30-5). */
  knownGaps: readonly string[];
  postingId: string | null;
  startupId: string | null;
  profileId?: string | null;
};

/**
 * The Draft application New application makes as writing starts (E31-4,
 * decided 17 November 2026), before any document: the documents are written
 * into it on the server, so leaving the page loses nothing. Claims the
 * reading, so a second click returns the application already made, with
 * `isNew` false.
 */
export async function createDraftApplication(input: DraftApplicationInput): Promise<{ id: string; isNew: boolean }> {
  const profileId = await profileIdOr(input.profileId);
  const settings = await loadSettings();
  const { details, reading } = input;
  const language = input.language.trim() || settings.docLanguage || reading.extracted.language || "English";
  return prisma.$transaction(async (tx) => {
    // Claim the reading first: a second click waits here, then finds it taken.
    const { count } = await tx.job.updateMany({ where: { id: input.readJobId, key: null }, data: { key: `${CLAIMED}pending` } });
    if (count === 0) {
      const claimed = await tx.job.findUniqueOrThrow({ where: { id: input.readJobId }, select: { key: true } });
      if (claimed.key?.startsWith(CLAIMED) && claimed.key !== `${CLAIMED}pending`) return { id: claimed.key.slice(CLAIMED.length), isNew: false };
      throw new ActionError("This application is already being created.");
    }
    const application = await tx.application.create({
      data: {
        profileId,
        title: details.title || [details.role, details.company].filter(Boolean).join(" · ") || "Untitled application",
        company: details.company,
        role: details.role,
        location: details.location,
        mode: details.mode,
        salary: details.salary,
        deadline: details.deadline ? new Date(`${details.deadline}T00:00:00Z`) : null,
        postingUrl: input.postingUrl,
        postingText: reading.posting,
        extracted: reading.extracted,
        extractedWith: reading.extractedWith,
        match: input.match,
        matchedWith: reading.matchedWith,
        tone: input.tone,
        ...(input.note.trim() ? { facts: { create: { text: input.note.trim() } } } : {}),
        ...(input.knownGaps.length > 0 ? { knownGaps: { create: [...new Set(input.knownGaps)].map((requirement) => ({ requirement })) } } : {}),
        language,
      },
      select: { id: true },
    });
    await tx.job.update({ where: { id: input.readJobId }, data: { key: `${CLAIMED}${application.id}`, applicationId: application.id } });
    // The posting it came from shows it as applied for (E14-8); one already linked keeps its application.
    if (input.postingId) await tx.posting.updateMany({ where: { id: input.postingId, applicationId: null }, data: { applicationId: application.id, archivedAt: null } });
    // The startup it was written to (#222).
    if (input.startupId) await tx.startup.updateMany({ where: { id: input.startupId, applicationId: null }, data: { applicationId: application.id } });
    return { id: application.id, isNew: true };
  });
}

export type SentApplicationInput = {
  /** The posting's text, or "". */
  posting: string;
  /** A checked http(s) link, or "". */
  postingUrl: string;
  company: string;
  role: string;
  /** The day it was sent, "2026-10-15". */
  sentOn: string;
  /** Where it stands now: Sent or later. */
  status: Exclude<ApplicationStatus, "DRAFT">;
  profileId?: string | null;
  /** The Positions posting or startup it was started from, as in New application. */
  postingId?: string | null;
  startupId?: string | null;
};

/**
 * An application the user sent before Dossier (public #129): its details and
 * where it stands, without a resume or cover letter. It's sent on `sentOn`, so
 * the board, the dashboard and follow-ups count from that day; a later status
 * is recorded as of now.
 */
export async function createSentApplication(input: SentApplicationInput, now = new Date()): Promise<string> {
  const profileId = await profileIdOr(input.profileId);
  const application = await prisma.$transaction(async (tx) => {
    const created = await tx.application.create({
      data: {
        profileId,
        title: [input.role, input.company].filter(Boolean).join(" · ") || "Untitled application",
        company: input.company,
        role: input.role,
        postingUrl: input.postingUrl,
        postingText: input.posting,
      },
      select: { id: true },
    });
    if (input.postingId) await tx.posting.updateMany({ where: { id: input.postingId, applicationId: null }, data: { applicationId: created.id, archivedAt: null } });
    if (input.startupId) await tx.startup.updateMany({ where: { id: input.startupId, applicationId: null }, data: { applicationId: created.id } });
    return created;
  });
  // Midday UTC is that day in nearly every time zone.
  const sentAt = new Date(`${input.sentOn}T12:00:00Z`);
  await applyStatusChange(prisma, application.id, ApplicationStatus.SENT, sentAt);
  if (input.status !== ApplicationStatus.SENT) await applyStatusChange(prisma, application.id, input.status, now > sentAt ? now : sentAt);
  return application.id;
}
