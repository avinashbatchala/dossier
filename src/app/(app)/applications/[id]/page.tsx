import type { Metadata } from "next";
import { cache } from "react";

import { activityTimeline } from "@/lib/activity";
import { isAiConfigured } from "@/lib/ai/config";
import { editsSchema, matchSchema } from "@/lib/application-data";
import { applicationFlag, latestContact } from "@/lib/application-flag";
import { loadApplication, loadDocuments, readJson } from "@/lib/application-documents";
import { formatShortDate } from "@/lib/dates";
import { resolveFileName } from "@/lib/file-name";
import { refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { writeDocumentJobKey } from "@/lib/jobs/write-document";
import { writeApplicationJob, writeApplicationJobKey } from "@/lib/jobs/write-application";
import { anyChannelFor } from "@/lib/notifications/notify";
import { checkRequirementsJobKey } from "@/lib/jobs/check-requirements";
import { prepareJobKey } from "@/lib/jobs/prepare-interview";
import { prepSchema } from "@/lib/interview-rounds";
import { messageJobKey } from "@/lib/jobs/write-message";
import { messageDraftSchema } from "@/lib/message-draft";
import { emailJobKey } from "@/lib/jobs/write-email";
import { googleConnection } from "@/lib/google/account";
import { fromLine } from "@/lib/google/mime";
import { pullInterviewEvents } from "@/lib/google/availability";
import { applicationChoices, loadConversation } from "@/lib/google/inbox-data";
import { readFrozenCopy } from "@/lib/frozen-copy";
import { profileUpdate } from "@/lib/profile-update";
import { refineSuggestions } from "@/lib/refine-suggestions";
import { resumeContent, sectionsWithContent } from "@/lib/resume-content";
import { sectionName } from "@/lib/resume-sections";
import { loadThemes } from "@/lib/theme-data";
import { userTimeZone } from "@/lib/time-zone";

import { ApplicationView } from "./application-view";
import { metaLine, roleLabel } from "./meta";
import { tabFrom } from "./tabs";
import { listProfiles } from "@/lib/profiles";
import { loadHistory } from "@/lib/application-history-data";

/**
 * Takes an interview moved or deleted in Google Calendar into the
 * application, once per request and before anything reads it:
 * loadApplication is cached for the request, and the title reads it first.
 */
const pullCalendar = cache((id: string) => pullInterviewEvents({ applicationId: id, signal: AbortSignal.timeout(3_000) }).catch(() => 0));

export async function generateMetadata({ params }: PageProps<"/applications/[id]">): Promise<Metadata> {
  const { id } = await params;
  await pullCalendar(id);
  const application = await loadApplication(id);
  return { title: application.title.trim() || "Untitled application" };
}

/** One application (PRD §6.5): its status, tailored documents, email, posting and notes. */
export default async function ApplicationPage({ params, searchParams }: PageProps<"/applications/[id]">) {
  const [{ id }, { tab, start }] = await Promise.all([params, searchParams]);
  await pullCalendar(id);
  const [{ application, profile, liveProfile, sent, settings, baseThemeId, extracted, resume, letter, email, includeReferences, sections, ownSections, letterDate }, aiReady, unitJobs, refineJobs, emailJobs, timeZone, google, emails, themes, resumeJobs, letterJobs, checkJobs, prepareJobs, messageJobs, profiles, writingJobs] =
    await Promise.all([
      loadDocuments(id),
      isAiConfigured(),
      findUnfinishedJobs(unitJobKey(id)),
      findUnfinishedJobs(refineJobKey(id)),
      findUnfinishedJobs(emailJobKey(id)),
      userTimeZone(),
      googleConnection(),
      loadConversation(id),
      loadThemes(),
      findUnfinishedJobs(writeDocumentJobKey(id, "RESUME")),
      findUnfinishedJobs(writeDocumentJobKey(id, "COVER_LETTER")),
      findUnfinishedJobs(checkRequirementsJobKey(id)),
      findUnfinishedJobs(prepareJobKey(id)),
      findUnfinishedJobs(messageJobKey(id)),
      listProfiles(),
      // New application writing its documents on the server (E31-4).
      findUnfinishedJobs(writeApplicationJobKey(id)),
    ]);
  // New application still writing its documents (E31-5): what it writes, and whether a notification will say when it's done.
  const last = writingJobs.at(-1);
  const writingInput = last ? writeApplicationJob.input.safeParse(last.input) : null;
  const writing = last && writingInput?.success ? { id: last.id, write: writingInput.data.write } : null;
  const notifies = writing ? await anyChannelFor("documents.written") : false;
  // Every change across the documents, and the answers (E30-11).
  const history = await loadHistory(id, application.messages);
  // Where a mail linked here by mistake can go instead (public #134).
  const moveTo = emails.some((mail) => mail.direction === "INCOMING") ? await applicationChoices(id) : [];

  const match = readJson(matchSchema, application.match);
  const messages = application.messages
    .map((message, index) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      targetUnit: message.targetUnit,
      // Written in code when the application was created (E7-6).
      opening: index === 0 && message.role === "AI" && !message.writtenWith,
      canUndo: message.role === "AI" && (readJson(editsSchema, message.edits)?.length ?? 0) > 0,
      undone: message.undone,
      at: message.createdAt.toISOString(),
    }))
    // Settings → "Show what changed" off hides the list of what was tailored (SET-5).
    .filter((message) => settings.showDiff || !message.opening);
  const { title, role, company, location, status, tone, language, followThemeLayout, showPhoto, nextInterviewAt } = application;
  // What it needs next (E27-2), as cards and the dashboard say it, in the breadcrumb (E30-2).
  const flag = applicationFlag(
    {
      status,
      deadline: application.deadline,
      sentAt: application.sentAt,
      lastStatusChange: application.events.reduce<Date | null>((latest, event) => (latest && latest > event.at ? latest : event.at), null),
      updatedAt: application.updatedAt,
      nextInterviewAt,
      lastContactAt: latestContact(emails.at(-1)?.sentAt, application.contactedAt),
      decideBy: application.offer?.decideBy ?? null,
      waitingReplies: emails.filter((mail) => mail.direction === "INCOMING" && !mail.handled).length,
    },
    { now: new Date(), quietDays: settings.quietDays, timeZone },
  );
  // Units still being rewritten, so a reload keeps showing it.
  const rewriting = unitJobs.flatMap((job) => {
    const input = regenerateUnitJob.input.safeParse(job.input);
    return input.success ? [{ jobId: job.id, document: input.data.document, unitId: input.data.unitId }] : [];
  });
  // The PDFs to attach to the email, named as they'll download (SET-8).
  const fileName = (doc: "RESUME" | "COVER_LETTER") =>
    resolveFileName(settings.fileNamePattern, { name: profile.basics.name, company: application.company, role: application.role, doc, date: new Date() });

  return (
    <ApplicationView
      application={{
        id,
        title,
        role,
        company,
        salary: application.salary,
        location,
        status,
        tone,
        language,
        followThemeLayout,
        showPhoto,
        archived: application.archivedAt !== null,
        awaitingReview: application.awaitingReview,
        nextInterviewAt,
      }}
      timeZone={timeZone}
      flag={flag}
      posting={{
        text: application.postingText,
        // New applications only keep web links, but an imported file could carry any URL (E11-5).
        url: /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "",
        pasted: formatShortDate(application.createdAt),
      }}
      match={match}
      requirements={extracted?.requirements ?? []}
      facts={application.facts}
      knownGaps={application.knownGaps.map((gap) => gap.requirement)}
      interviews={application.interviews.map((round) => ({
        id: round.id,
        round: round.round,
        at: round.at?.toISOString() ?? null,
        minutes: round.minutes,
        place: round.place,
        people: round.people,
        notes: round.notes,
        prep: readJson(prepSchema, round.prep),
      }))}
      inCalendar={application.interviewEventId !== null}
      preparing={prepareJobs.at(-1)?.id ?? null}
      offer={
        application.offer && {
          salary: application.offer.salary,
          decideBy: application.offer.decideBy?.toISOString().slice(0, 10) ?? null,
          startDate: application.offer.startDate?.toISOString().slice(0, 10) ?? null,
          holidays: application.offer.holidays,
          office: application.offer.office,
          fromEmail: application.offer.fromEmailId !== null,
        }
      }
      messageDraft={readJson(messageDraftSchema, application.messageDraft)}
      writingMessage={messageJobs.at(-1)?.id ?? null}
      threadReady={application.emailThreadId !== null && google.status === "connected" && google.canSend}
      start={start === "prepare" || start === "follow-up" ? start : null}
      roles={liveProfile.experience.map((entry) => ({ id: entry.id, label: roleLabel(entry) }))}
      activity={activityTimeline({ notes: application.notes, events: application.events, createdAt: application.createdAt })}
      meta={metaLine(application, profiles.length > 1 ? (profiles.find((entry) => entry.id === application.profileId) ?? profiles[0]).name : "", { timeZone })}
      resume={resume}
      letter={letter}
      themes={themes}
      baseThemeId={baseThemeId}
      email={email}
      writingEmail={emailJobs.at(-1)?.id ?? null}
      writingDocuments={{ resume: resumeJobs.at(-1)?.id ?? null, letter: letterJobs.at(-1)?.id ?? null }}
      writingApplication={writing && { jobId: writing.id, write: writing.write, notifies }}
      versions={Object.fromEntries(application.documents.map((document) => [document.kind, document._count.versions]))}
      checkingRequirements={checkJobs.at(-1)?.id ?? null}
      attachments={{ resume: resume ? fileName("RESUME") : null, letter: letter ? fileName("COVER_LETTER") : null }}
      gmail={
        google.status === "not-configured" && emails.length === 0
          ? undefined
          : {
              sender:
                google.status === "connected"
                  ? google.canSend
                    ? // As the mail goes out: "Jane Doe <jane@gmail.com>" (#358).
                      { from: fromLine(liveProfile.basics.name, google.email) }
                    : { from: null, reason: "no-permission" }
                  : { from: null, reason: google.status === "not-configured" ? "not-configured" : "not-connected" },
              sentBefore: application.emailThreadId !== null,
              emails,
              moveTo,
              reading: google.status === "connected" && google.canRead && settings.gmailRead,
            }
      }
      profile={profile}
      paper={settings.paper}
      dateFormat={settings.dateFormat}
      includeReferences={includeReferences}
      sections={sections}
      ownSections={ownSections}
      sent={sent}
      canUpdate={
        resume !== null &&
        profileUpdate({
          copy: readFrozenCopy(application.frozen)?.profile ?? null,
          live: liveProfile,
          units: resume.units,
          trimmed: resume.trimmed ?? null,
          language: application.language,
          includeReferences,
        }).changed
      }
      baseSections={sectionsWithContent(resumeContent(liveProfile, { includeReferences: true })).map((key) => ({ key, name: sectionName(key, liveProfile.customSections) }))}
      letterDate={letterDate}
      initialTab={tabFrom(tab)}
      aiReady={aiReady}
      rewriting={rewriting}
      messages={messages}
      history={history}
      refining={refineJobs.at(-1)?.id ?? null}
      suggestions={refineSuggestions({
        match,
        requirements: extracted?.requirements ?? [],
        tone,
        hasSummary: Boolean(resume?.units.some((unit) => unit.id === "summary" && unit.text.trim())),
      })}
    />
  );
}
