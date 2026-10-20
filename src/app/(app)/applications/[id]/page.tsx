import type { Metadata } from "next";
import { cache } from "react";

import { activityTimeline } from "@/lib/activity";
import { isAiConfigured } from "@/lib/ai/config";
import { editsSchema, matchSchema, matchScore } from "@/lib/application-data";
import { loadApplication, loadDocuments, readJson } from "@/lib/application-documents";
import { formatShortDate } from "@/lib/dates";
import { resolveFileName } from "@/lib/file-name";
import { refineJobKey } from "@/lib/jobs/refine";
import { regenerateUnitJob, unitJobKey } from "@/lib/jobs/regenerate-unit";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { emailJobKey } from "@/lib/jobs/write-email";
import { googleConnection } from "@/lib/google/account";
import { pullInterviewEvents } from "@/lib/google/availability";
import { loadConversation } from "@/lib/google/inbox-data";
import { refineSuggestions } from "@/lib/refine-suggestions";
import { userTimeZone } from "@/lib/time-zone";

import { ApplicationView } from "./application-view";
import { metaLine } from "./meta";
import { tabFrom } from "./tabs";

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
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  await pullCalendar(id);
  const [{ application, profile, settings, extracted, resume, letter, email, includeReferences, letterDate }, aiReady, unitJobs, refineJobs, emailJobs, timeZone, google, emails] =
    await Promise.all([
      loadDocuments(id),
      isAiConfigured(),
      findUnfinishedJobs(unitJobKey(id)),
      findUnfinishedJobs(refineJobKey(id)),
      findUnfinishedJobs(emailJobKey(id)),
      userTimeZone(),
      googleConnection(),
      loadConversation(id),
    ]);

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
    }))
    // Settings → "Show what changed" off hides the list of what was tailored (SET-5).
    .filter((message) => settings.showDiff || !message.opening);
  const { title, company, location, status, tone, language, followThemeLayout, nextInterviewAt } = application;
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
        company,
        location,
        status,
        tone,
        language,
        followThemeLayout,
        archived: application.archivedAt !== null,
        awaitingReview: application.awaitingReview,
        nextInterviewAt,
      }}
      timeZone={timeZone}
      posting={{
        text: application.postingText,
        // New applications only keep web links, but an imported file could carry any URL (E11-5).
        url: /^https?:\/\//i.test(application.postingUrl) ? application.postingUrl : "",
        pasted: formatShortDate(application.createdAt),
      }}
      match={match}
      requirements={extracted?.requirements ?? []}
      activity={activityTimeline({ notes: application.notes, events: application.events, createdAt: application.createdAt })}
      meta={metaLine(application)}
      resume={resume}
      letter={letter}
      email={email}
      writingEmail={emailJobs.at(-1)?.id ?? null}
      attachments={{ resume: resume ? fileName("RESUME") : null, letter: letter ? fileName("COVER_LETTER") : null }}
      gmail={
        google.status === "not-configured" && emails.length === 0
          ? undefined
          : {
              sender:
                google.status === "connected"
                  ? google.canSend
                    ? { from: google.email }
                    : { from: null, reason: "no-permission" }
                  : { from: null, reason: google.status === "not-configured" ? "not-configured" : "not-connected" },
              sentBefore: application.emailThreadId !== null,
              emails,
              reading: google.status === "connected" && google.canRead && settings.gmailRead,
            }
      }
      profile={profile}
      paper={settings.paper}
      dateFormat={settings.dateFormat}
      includeReferences={includeReferences}
      letterDate={letterDate}
      score={match && match.items.length > 0 ? matchScore(match) : null}
      initialTab={tabFrom(tab)}
      aiReady={aiReady}
      rewriting={rewriting}
      messages={messages}
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
