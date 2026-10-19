"use client";

import { useRouter } from "next/navigation";
import { Switch } from "radix-ui";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";

import { plainUnit, type UnitRenderer } from "@/components/documents/document-page";
import { DocumentPreview } from "@/components/documents/document-preview";
import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DocumentKind,
  type ApplicationStatus,
  type DateFormat,
  type PaperSize,
  type Tone,
} from "@/generated/prisma/enums";
import { type Match, type Requirement, type Unit } from "@/lib/application-data";
import { EMAIL_UNITS, WRITTEN_EMAIL_UNITS } from "@/lib/application-email";
import { englishFrame, isFrameUnit, isParagraph, withFrame, WRITTEN_FRAME_UNITS } from "@/lib/letter-frame";
import type { ActivityEntry } from "@/lib/activity";
import type { DocumentData } from "@/lib/application-documents";
import { retry } from "@/lib/jobs/actions";
import type { RefineResult } from "@/lib/jobs/refine";
import type { RegenerateUnitResult } from "@/lib/jobs/regenerate-unit";
import type { JobView } from "@/lib/jobs/runner";
import type { WriteEmailResult } from "@/lib/jobs/write-email";
import type { ProfileData } from "@/lib/profile";
import type { RefineSuggestions } from "@/lib/refine-suggestions";
import { hasSidebar } from "@/lib/themes";
import { cleanUnitText, unitName } from "@/lib/unit-text";

import {
  addMatchSkill,
  putBackTrimmed,
  restoreUnit,
  restoreVersion,
  saveUnit,
  sendMessage,
  setFollowThemeLayout,
  startRegenerating,
  startWritingEmail,
  undoEmailRewrite,
  undoMessage,
} from "./actions";
import { ApplicationHeader } from "./application-header";
import { ApplicationMenu } from "./application-menu";
import { ConversationTab } from "./conversation-tab";
import { EmailTab, type Attachments } from "./email-tab";
import type { GmailSender } from "./send-with-gmail";

import { JobWatcher } from "./job-watcher";
import { NotesTab } from "./notes-tab";
import { PostingTab, type PostingData } from "./posting-tab";
import { RefinePanel, type ChatEntry } from "./refine-panel";
import { StatusControl } from "./status-control";
import { TrimmedNotice } from "./trimmed-notice";

import { aboutWords, type Tab } from "./tabs";
import { UnitFrame } from "./unit-frame";
import { VersionHistory, type ViewedVersion } from "./version-history";
import type { EmailView } from "@/lib/google/inbox-data";


/** A unit on the page: its document and id, e.g. "RESUME summary". */
const keyOf = (kind: DocumentKind, unitId: string) => `${kind} ${unitId}`;
const splitKey = (key: string) => {
  const space = key.indexOf(" ");
  return [key.slice(0, space) as DocumentKind, key.slice(space + 1)] as const;
};

/** How long a changed unit glows (APP-6). */
export const FLASH_MS = 1600;

/** A background job being followed; `revision` goes up with each Retry. */
type Rewrite = { jobId: string; revision: number };

/** The tab each document is on. */
const TAB_OF: Record<DocumentKind, Tab> = { RESUME: "resume", COVER_LETTER: "letter", EMAIL: "email" };

/** The unit the next chat message is about ("Ask AI"). */
type Target = { document: DocumentKind; unitId: string; label: string; name: string };

const NO_MESSAGES: ChatEntry[] = [];

const NO_AI = "That needs an AI provider. Choose one in Settings → AI provider.";

const NOTHING_SAVING: Readonly<Record<string, string>> = {};

export type ApplicationViewProps = {
  application: {
    id: string;
    title: string;
    company: string;
    location: string;
    status: ApplicationStatus;
    tone: Tone;
    /** The documents' language, e.g. "English". */
    language: string;
    followThemeLayout: boolean;
    archived: boolean;
    /** The next interview, while in Interview (E9-9). */
    nextInterviewAt: Date | null;
  };
  /** The browser's time zone as it last told the server, for the interview's time. */
  timeZone?: string;
  posting: PostingData;
  /** How the profile matches the posting (NEW-4), when it was read. */
  match: Match | null;
  /** The posting's requirements, in the same order as the match's items. */
  requirements: Requirement[];
  /** Notes and status changes, newest first (E8-9). */
  activity: ActivityEntry[];
  meta: string[];
  resume: DocumentData | null;
  letter: DocumentData | null;
  /** The email to send the application with (Email tab), once it's written. */
  email: Unit[] | null;
  /** The email being written, e.g. since before a reload. */
  writingEmail: string | null;
  /** The PDFs to attach to the email. */
  attachments: Attachments;
  /** Sending through Gmail (E15-2), and the application's mail (E15-3). */
  gmail?: { sender: GmailSender; sentBefore: boolean; emails: EmailView[]; reading: boolean };
  profile: ProfileData;
  paper: PaperSize;
  dateFormat: DateFormat;
  /** Settings → "Include references", when the posting asks for them (SET-9). */
  includeReferences: boolean;
  /** The date on the letter, at UTC midnight. */
  letterDate: Date;
  /** "5/7 match" on the Job posting tab, when the requirements were matched. */
  score: { hit: number; total: number } | null;
  initialTab: Tab;
  /** Whether an AI provider is set up; without one, the AI buttons point to Settings. */
  aiReady: boolean;
  /** Units being rewritten in the background (E8-4), e.g. since before a reload. */
  rewriting: { jobId: string; document: DocumentKind; unitId: string }[];
  /** The Refine with AI conversation (E8-5), oldest first. */
  messages: ChatEntry[];
  /** A reply still being written, e.g. since before a reload. */
  refining: string | null;
  suggestions: RefineSuggestions;
};

/**
 * An application's page below the sidebar: the header with its tabs, the
 * active tab's document on the canvas, and the right column, which moves
 * below the document on narrow windows. The tab is kept in the URL.
 */
export function ApplicationView({
  application,
  timeZone,
  meta,
  posting,
  match,
  requirements,
  activity,
  resume,
  letter,
  email,
  writingEmail,
  attachments,
  gmail,
  profile,
  paper,
  dateFormat,
  includeReferences,
  letterDate,
  score,
  initialTab,
  aiReady,
  rewriting: rewritingAtLoad,
  messages,
  refining,
  suggestions,
}: ApplicationViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [followLayout, showFollowLayout] = useOptimistic(application.followThemeLayout);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  // Texts being saved, shown in place until the page has the saved version.
  const [saving, showSaving] = useOptimistic(NOTHING_SAVING, (texts, { key, text }: { key: string; text: string }) => ({
    ...texts,
    [key]: text,
  }));
  const flashing = useFlashing();
  const [target, setTarget] = useState<Target | null>(null);
  // E8-10: the document whose history is open, and an earlier version shown in its place.
  const [historyOf, setHistoryOf] = useState<DocumentKind | null>(null);
  const [viewing, setViewing] = useState<ViewedVersion | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [reply, setReply] = useState<Rewrite | null>(refining ? { jobId: refining, revision: 0 } : null);
  // The message being sent, shown until the page has it.
  const [sending, showSending] = useOptimistic(NO_MESSAGES, (current, message: ChatEntry) => [...current, message]);
  // Replies being undone, shown as undone until the page has it.
  const [undoing, showUndoing] = useOptimistic<readonly string[], string>([], (current, id) => [...current, id]);
  const [chatFocus, focusChat] = useState(0);
  const [rewrites, setRewrites] = useState<Readonly<Record<string, Rewrite>>>(() =>
    Object.fromEntries(rewritingAtLoad.map(({ jobId, document, unitId }) => [keyOf(document, unitId), { jobId, revision: 0 }])),
  );
  const [emailJob, setEmailJob] = useState<Rewrite | null>(writingEmail ? { jobId: writingEmail, revision: 0 } : null);

  /** The document on screen, which a chat message without a target is most likely about. */
  const onScreen = (): DocumentKind | null =>
    tab === "resume" ? DocumentKind.RESUME : tab === "letter" ? DocumentKind.COVER_LETTER : tab === "email" && email ? DocumentKind.EMAIL : null;

  const selectTab = (value: string) => {
    const next = value as Tab;
    setTab(next);
    // Next.js follows replaceState, so a refresh keeps the tab.
    const url = new URL(window.location.href);
    if (next === "resume") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const changeLayout = (follow: boolean) =>
    startTransition(async () => {
      showFollowLayout(follow);
      toastResult(await setFollowThemeLayout({ id: application.id, follow }));
    });

  const save = (kind: DocumentKind, unit: Unit, text: string) => {
    const key = keyOf(kind, unit.id);
    startTransition(async () => {
      showSaving({ key, text: cleanUnitText(unit.id, text) });
      const result = await saveUnit({ id: application.id, document: kind, unitId: unit.id, text, expected: unit.text });
      if (!result.ok) {
        // The editor stays open with what was typed.
        toast(result.error);
        return;
      }
      setEditing((current) => (current === key ? null : current));
      flashing.start([key]);
    });
  };

  const needsAi = () => {
    toast(NO_AI, { action: { label: "Open Settings", onClick: () => router.push("/settings?section=ai") } });
  };

  const stopRewriting = (key: string) =>
    setRewrites((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key)));

  /** "Regenerate" (E8-4): the unit dims while it's rewritten; the rest stays usable. */
  const regenerate = async (kind: DocumentKind, unit: Unit, { stored = true }: { stored?: boolean } = {}) => {
    if (!aiReady) return needsAi();
    const key = keyOf(kind, unit.id);
    setRewrites((current) => ({ ...current, [key]: { jobId: "", revision: 0 } }));
    // A letter part an older letter only shows (E8-11) is stored as shown, then rewritten.
    const result = await startRegenerating({ id: application.id, document: kind, unitId: unit.id, ...(stored ? {} : { shown: unit.text }) });
    if (result.ok) setRewrites((current) => ({ ...current, [key]: { jobId: result.data, revision: 0 } }));
    else {
      stopRewriting(key);
      toast(result.error);
    }
  };

  const rewriteChanged = (kind: DocumentKind, unitId: string, job: JobView<RegenerateUnitResult>) => {
    const key = keyOf(kind, unitId);
    const units = { [DocumentKind.RESUME]: resume?.units, [DocumentKind.COVER_LETTER]: letter?.units, [DocumentKind.EMAIL]: email }[kind];
    const name = unitName(units?.find((entry) => entry.id === unitId) ?? { id: unitId, label: "" });
    if (job.status === "FAILED") {
      // Nothing was changed, so the unit is as it was.
      stopRewriting(key);
      const { jobId, revision } = rewrites[key] ?? { jobId: job.id, revision: 0 };
      toast(job.error ?? "That didn't work. Try again.", {
        action: {
          label: "Retry",
          onClick: () =>
            void retry({ id: jobId }).then((retried) => {
              if (retried.ok) setRewrites((current) => ({ ...current, [key]: { jobId, revision: revision + 1 } }));
              else toast(retried.error);
            }),
        },
      });
      return;
    }
    if (job.status !== "DONE" || !job.result) return;
    stopRewriting(key);
    const result = job.result;
    if (result.outcome === "changed") {
      toast(`The ${name} changed while I was rewriting it, so I left your version.`);
      return;
    }
    startTransition(() => router.refresh());
    flashing.start([key]);
    toast(`Rewrote the ${name}.`, {
      action: {
        label: "Undo",
        onClick: () =>
          startTransition(async () => {
            const undone = await restoreUnit({
              id: application.id,
              document: kind,
              unitId,
              text: result.previous.text,
              unverified: result.previous.unverified,
              expected: result.unit.text,
            });
            if (!undone.ok) return toast(undone.error);
            flashing.start([key]);
            toast(`Put the ${name} back.`);
          }),
      },
    });
  };

  /** "Ask AI" (APP-5): the next message is about this unit. */
  const askAbout = (kind: DocumentKind, unit: Unit) => {
    setTarget({ document: kind, unitId: unit.id, label: unit.label, name: unitName(unit) });
    focusChat((count) => count + 1);
  };

  /** Sends a chat message (E8-5); resolves to whether it went. */
  const send = (text: string) =>
    new Promise<boolean>((resolve) => {
      const viewing = onScreen();
      if ((viewing || target) && !aiReady) {
        needsAi();
        return resolve(false);
      }
      startTransition(async () => {
        showSending({ id: "sending", role: "USER", text, targetUnit: target?.label ?? null, opening: false, canUndo: false, undone: false });
        const result = await sendMessage({
          id: application.id,
          text,
          viewing,
          target: target && { document: target.document, unitId: target.unitId },
        });
        if (!result.ok) {
          toast(result.error);
          return resolve(false);
        }
        setTarget(null);
        if (result.data.jobId) setReply({ jobId: result.data.jobId, revision: 0 });
        resolve(true);
      });
    });

  const replyChanged = (job: JobView<RefineResult>) => {
    if (job.status === "FAILED") {
      setReply(null);
      toast(job.error ?? "That didn't work. Try again.", {
        action: {
          label: "Retry",
          onClick: () =>
            void retry({ id: job.id }).then((retried) => {
              if (retried.ok) setReply((current) => ({ jobId: job.id, revision: (current?.revision ?? 0) + 1 }));
              else toast(retried.error);
            }),
        },
      });
      return;
    }
    if (job.status !== "DONE" || !job.result) return;
    setReply(null);
    startTransition(() => router.refresh());
    const { edited } = job.result;
    flashing.start(edited.map(({ document, unitId }) => keyOf(document, unitId)));
    // Show the change, on the other document if that's where it is.
    const viewing = onScreen();
    if (edited.length > 0 && !edited.some(({ document }) => document === viewing)) selectTab(TAB_OF[edited[0].document]);
  };

  /** "Write the email" and "Rewrite" on the Email tab: written in the background. */
  const writeEmail = async () => {
    if (!aiReady) return needsAi();
    if (emailJob) return;
    setEmailJob({ jobId: "", revision: 0 });
    const result = await startWritingEmail({ id: application.id });
    if (result.ok) setEmailJob({ jobId: result.data, revision: 0 });
    else {
      setEmailJob(null);
      toast(result.error);
    }
  };

  const emailChanged = (job: JobView<WriteEmailResult>) => {
    if (job.status === "FAILED") {
      setEmailJob(null);
      toast(job.error ?? "That didn't work. Try again.", {
        action: {
          label: "Retry",
          onClick: () =>
            void retry({ id: job.id }).then((retried) => {
              if (retried.ok) setEmailJob((current) => ({ jobId: job.id, revision: (current?.revision ?? 0) + 1 }));
              else toast(retried.error);
            }),
        },
      });
      return;
    }
    if (job.status !== "DONE" || !job.result) return;
    setEmailJob(null);
    startTransition(() => router.refresh());
    const keys = EMAIL_UNITS.map((id) => keyOf(DocumentKind.EMAIL, id));
    flashing.start(keys);
    // The first email just appears; a rewrite can be undone.
    if (!job.result.previous) return;
    toast("Rewrote the email.", {
      action: {
        label: "Undo",
        onClick: () =>
          startTransition(async () => {
            const undone = await undoEmailRewrite({ id: application.id, jobId: job.id });
            if (!undone.ok) return toast(undone.error);
            flashing.start(keys);
            toast("Put the email back.");
          }),
      },
    });
  };

  /** "+ Add to profile" on the Job posting tab (E8-7). */
  const addSkill = (index: number) =>
    startTransition(async () => {
      const result = await addMatchSkill({ id: application.id, index });
      if (!result.ok) return toast(result.error);
      toast(`Added “${result.data.name}” to your skills. Attach it to a role under Experience to make it count.`);
    });

  /** "Put back" something left out to fit one page (E10-10). */
  const putBack = (index: number) =>
    startTransition(async () => {
      const result = await putBackTrimmed({ id: application.id, index });
      if (!result.ok) return toast(result.error);
      toast("Put back. The resume may run over one page now.");
    });

  /** "Undo" under a reply (E8-6): puts back what it changed. */
  const undo = (message: ChatEntry) =>
    startTransition(async () => {
      showUndoing(message.id);
      const result = await undoMessage({ id: application.id, messageId: message.id });
      if (!result.ok) return toast(result.error);
      flashing.start(result.data.edited.map(({ document, unitId }) => keyOf(document, unitId)));
    });

  /** The document's units, with texts being saved in place. */
  const shown = (kind: DocumentKind, units: Unit[]) =>
    units.map((unit) => {
      const text = saving[keyOf(kind, unit.id)];
      return text === undefined ? unit : { ...unit, text, unverified: undefined };
    });

  /**
   * Draws each unit of a document with its toolbar and editor (E8-3). The
   * letter's sender, date and signature are edited, not written by the AI
   * (E8-11); a part an older letter only shows is stored when it's first
   * edited or regenerated.
   */
  const unitsOf = (kind: DocumentKind, units: Unit[], stored: ReadonlySet<string> = new Set(units.map((unit) => unit.id))): UnitRenderer =>
    function renderEditableUnit({ id, className, head, children }) {
      const unit = units.find((entry) => entry.id === id);
      if (!unit) return plainUnit({ id, className, head, children });
      const key = keyOf(kind, id);
      const written = kind === DocumentKind.EMAIL ? WRITTEN_EMAIL_UNITS.has(id) : !isFrameUnit(id) || WRITTEN_FRAME_UNITS.has(id);
      return (
        <UnitFrame
          id={id}
          className={className}
          head={head}
          unit={unit}
          editing={editing === key}
          saving={editing === key && saving[key] !== undefined}
          busy={key in rewrites}
          flashing={flashing.keys.has(key)}
          onEdit={() => setEditing(key)}
          onCancel={() => setEditing(null)}
          onSave={(text) => save(kind, unit, text)}
          onRegenerate={written ? () => void regenerate(kind, unit, { stored: stored.has(id) }) : undefined}
          // The chat only edits parts the letter stores.
          onAskAi={written && stored.has(id) ? () => askAbout(kind, unit) : undefined}
        >
          {children}
        </UnitFrame>
      );
    };

  const resumeUnits = resume && shown(DocumentKind.RESUME, resume.units);
  // Every part of the letter, those it doesn't store yet as they've always been drawn (E8-11).
  const letterUnits =
    letter &&
    withFrame(
      shown(DocumentKind.COVER_LETTER, letter.units),
      englishFrame({ basics: profile.basics, company: application.company, location: application.location, date: letterDate, dateFormat }),
    );
  const letterStored = new Set(letter?.units.map((unit) => unit.id));
  const emailUnits = email && shown(DocumentKind.EMAIL, email);
  const paragraphs = letterUnits?.filter(isParagraph).map((unit) => unit.text) ?? [];
  const hint = "Hover a section to edit or regenerate it";

  const restore = async (version: ViewedVersion) => {
    setRestoring(true);
    const result = toastResult(await restoreVersion({ id: application.id, versionId: version.id }));
    setRestoring(false);
    if (!result.ok) return;
    setViewing(null);
    startTransition(() => router.refresh());
  };

  /** "History" next to a document's label, and the banner over an earlier version. */
  const historyButton = (document: DocumentKind) => (
    <Button variant="text" size="sm" onClick={() => setHistoryOf(document)}>
      History
    </Button>
  );
  const versionBanner = (version: ViewedVersion) => (
    <div role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
      <span>
        You&apos;re looking at the version from {version.when}: {version.label}.
      </span>
      <span className="flex items-center gap-3">
        <Button size="sm" aria-disabled={restoring || undefined} onClick={() => void (restoring ? undefined : restore(version))}>
          Restore this version
        </Button>
        <Button variant="secondary" size="sm" className="bg-input" onClick={() => setViewing(null)}>
          Back to the current one
        </Button>
      </span>
    </div>
  );
  const viewed = (document: DocumentKind) => (viewing?.document === document ? viewing : null);
  const notes = activity.filter((entry) => entry.kind === "note").length;
  const waiting = gmail?.emails.filter((email) => email.direction === "INCOMING" && !email.handled).length ?? 0;

  return (
    // Wide enough for the refine panel beside the documents, the page fills the
    // window: the document scrolls in its column and the panel keeps its input
    // in view. Narrower, the panel moves below and the page scrolls as usual.
    <div className="@container/page flex flex-1 flex-col">
    <Tabs value={tab} onValueChange={selectTab} className="flex flex-1 flex-col @min-[780px]/page:h-panel @min-[780px]/page:flex-none">
      {Object.entries(rewrites).map(([key, { jobId, revision }]) =>
        jobId ? (
          <JobWatcher<RegenerateUnitResult>
            key={jobId}
            id={jobId}
            revision={revision}
            onChange={(job) => {
              const [kind, unitId] = splitKey(key);
              rewriteChanged(kind, unitId, job);
            }}
          />
        ) : null,
      )}
      {reply && <JobWatcher<RefineResult> key={reply.jobId} id={reply.jobId} revision={reply.revision} onChange={replyChanged} />}
      {emailJob?.jobId && (
        <JobWatcher<WriteEmailResult> key={emailJob.jobId} id={emailJob.jobId} revision={emailJob.revision} onChange={emailChanged} />
      )}
      <ApplicationHeader
        title={application.title}
        meta={meta}
        actions={
          <>
            {application.archived && <span className="rounded-full bg-track px-3 py-1.5 text-meta text-muted">Archived</span>}
            <StatusControl id={application.id} status={application.status} interviewAt={application.nextInterviewAt} timeZone={timeZone} />
            {(resume || letter) && (
              // The document on screen; from the Job posting tab, the resume (E8-8).
              <DownloadPdfButton
                variant="secondary"
                href={`/api/pdf?doc=${tab === "letter" ? "letter" : "resume"}&application=${application.id}`}
                progress={`Rendering your ${tab === "letter" ? "cover letter" : "tailored resume"} as a PDF…`}
              >
                Download PDF
              </DownloadPdfButton>
            )}
            <ApplicationMenu id={application.id} archived={application.archived} />
          </>
        }
      >
        {/* Its underline runs the header's full width, under the padding too. */}
        <TabsList aria-label="Application" className="-mx-10 px-10">
          <TabsTrigger value="resume">Resume</TabsTrigger>
          <TabsTrigger value="letter">Cover letter</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          {gmail && (gmail.reading || gmail.emails.length > 0) && (
            <TabsTrigger value="conversation">
              {waiting > 0 ? `Conversation · ${waiting} new` : gmail.emails.length > 0 ? `Conversation · ${gmail.emails.length}` : "Conversation"}
            </TabsTrigger>
          )}
          <TabsTrigger value="posting">{score ? `Job posting · ${score.hit}/${score.total} match` : "Job posting"}</TabsTrigger>
          <TabsTrigger value="notes">{notes > 0 ? `Notes · ${notes}` : "Notes"}</TabsTrigger>
        </TabsList>
      </ApplicationHeader>

      <div className="@container flex min-h-0 flex-1 flex-wrap @min-[780px]/page:flex-nowrap">
        <TabsContent value="resume" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          {resume && resumeUnits ? (
            <DocumentPreview
              meta={viewed(DocumentKind.RESUME) ? undefined : hint}
              notice={
                viewed(DocumentKind.RESUME) ? (
                  versionBanner(viewed(DocumentKind.RESUME)!)
                ) : resume.trimmed?.length ? (
                  <TrimmedNotice items={resume.trimmed} onPutBack={putBack} />
                ) : undefined
              }
              label={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Tailored resume · {resume.theme.name} theme</span>
                  {hasSidebar(resume.theme.layout) && (
                    <LayoutSwitch checked={followLayout} onCheckedChange={changeLayout} />
                  )}
                  {historyButton(DocumentKind.RESUME)}
                </span>
              }
            >
              <TailoredResume
                resume={{ ...resume, units: viewed(DocumentKind.RESUME)?.units ?? resumeUnits }}
                profile={profile}
                paper={paper}
                followThemeLayout={followLayout}
                language={application.language}
                includeReferences={includeReferences}
                renderUnit={viewed(DocumentKind.RESUME) ? plainUnit : unitsOf(DocumentKind.RESUME, resumeUnits)}
              />
            </DocumentPreview>
          ) : (
            <MissingDocument>This application has no tailored resume.</MissingDocument>
          )}
        </TabsContent>

        <TabsContent value="letter" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          {letter && letterUnits ? (
            <DocumentPreview
              label={
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>Cover letter · {aboutWords(paragraphs)}</span>
                  {historyButton(DocumentKind.COVER_LETTER)}
                </span>
              }
              meta={viewed(DocumentKind.COVER_LETTER) ? undefined : hint}
              notice={viewed(DocumentKind.COVER_LETTER) ? versionBanner(viewed(DocumentKind.COVER_LETTER)!) : undefined}
            >
              <TailoredLetter
                letter={{ ...letter, units: viewed(DocumentKind.COVER_LETTER)?.units ?? letterUnits }}
                profile={profile}
                paper={paper}
                company={application.company}
                location={application.location}
                tone={application.tone}
                date={letterDate}
                dateFormat={dateFormat}
                language={application.language}
                renderUnit={viewed(DocumentKind.COVER_LETTER) ? plainUnit : unitsOf(DocumentKind.COVER_LETTER, letterUnits, letterStored)}
              />
            </DocumentPreview>
          ) : (
            <MissingDocument>This application has no cover letter.</MissingDocument>
          )}
        </TabsContent>

        <TabsContent value="email" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          <EmailTab
            applicationId={application.id}
            units={viewed(DocumentKind.EMAIL)?.units ?? emailUnits}
            renderUnit={viewed(DocumentKind.EMAIL) || !emailUnits ? plainUnit : unitsOf(DocumentKind.EMAIL, emailUnits)}
            history={historyButton(DocumentKind.EMAIL)}
            hint={viewed(DocumentKind.EMAIL) ? undefined : "Hover a part to edit or regenerate it"}
            notice={viewed(DocumentKind.EMAIL) ? versionBanner(viewed(DocumentKind.EMAIL)!) : undefined}
            writing={emailJob !== null}
            onWrite={() => void writeEmail()}
            attachments={attachments}
            gmail={gmail && { sender: gmail.sender, sentBefore: gmail.sentBefore }}
          />
        </TabsContent>

        <TabsContent value="conversation" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          <ConversationTab emails={gmail?.emails ?? []} aiReady={aiReady} timeZone={timeZone} reading={gmail?.reading ?? false} />
        </TabsContent>

        <TabsContent value="posting" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          <PostingTab posting={posting} match={match} requirements={requirements} onAddSkill={(index) => addSkill(index)} />
        </TabsContent>

        <TabsContent value="notes" className="flex min-h-0 min-w-0 flex-[999_1_480px]">
          <NotesTab applicationId={application.id} activity={activity} />
        </TabsContent>

        <VersionHistory
          applicationId={application.id}
          document={historyOf}
          onOpenChange={(open) => !open && setHistoryOf(null)}
          onView={(version) => {
            setViewing(version);
            setHistoryOf(null);
          }}
        />
        <RefinePanel
          tab={tab}
          messages={[...messages, ...sending]}
          thinking={reply !== null}
          suggestions={tab === "resume" ? suggestions.resume : tab === "letter" ? suggestions.letter : tab === "email" && email ? suggestions.email : []}
          target={target}
          onClearTarget={() => setTarget(null)}
          onSend={send}
          aiReady={aiReady}
          focusRequest={chatFocus}
        >
          {(message) =>
            message.canUndo &&
            (message.undone || undoing.includes(message.id) ? (
              <span className="px-1 text-label text-muted">Undone</span>
            ) : (
              <button
                type="button"
                onClick={() => undo(message)}
                className="px-1 text-label text-muted underline underline-offset-3 hover:text-ink"
              >
                Undo
              </button>
            ))
          }
        </RefinePanel>
      </div>
    </Tabs>
    </div>
  );
}

/** Units that glow for a moment after they changed; `start` makes them glow. */
function useFlashing() {
  const [keys, setKeys] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const start = (started: string[]) => {
    setKeys((current) => new Set([...current, ...started]));
    for (const key of started) {
      clearTimeout(timers.current.get(key));
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setKeys((current) => new Set([...current].filter((entry) => entry !== key)));
        }, FLASH_MS),
      );
    }
  };

  return { keys, start };
}

/** The Resume tab's switch between the theme's sidebar layout and a single column (decided in E5-1 #42). */
function LayoutSwitch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <span className="flex items-center gap-2">
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="flex h-4 w-7 shrink-0 items-center rounded-full bg-toggle-off p-0.5 data-[state=checked]:bg-primary motion-safe:transition-colors"
      >
        <Switch.Thumb className="block size-3 rounded-full bg-white shadow-knob data-[state=checked]:translate-x-3 motion-safe:transition-transform" />
      </Switch.Root>
      <label htmlFor={id} className="cursor-pointer">
        Sidebar layout
      </label>
    </span>
  );
}

/** The canvas with a note in place of a document the application doesn't have. */
function MissingDocument({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center overflow-auto bg-canvas px-10 pt-16 pb-16">
      <p className="max-w-[420px] text-center text-muted">{children}</p>
    </div>
  );
}
