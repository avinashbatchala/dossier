"use client";

import { Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import { FitDetails } from "@/components/fit-details";
import { ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { Tone } from "@/generated/prisma/enums";
import { coverageBand, matchScore, type Match, type MatchResult, type Requirement } from "@/lib/application-data";
import { applicationFlag } from "@/lib/application-flag";
import { cn } from "@/lib/cn";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import type { PostingFit } from "@/lib/fit";
import { postingHighlights } from "@/lib/posting-highlights";
import { DOCUMENTS_TO_WRITE, type DocumentsToWrite } from "@/lib/settings";
import { TONES } from "@/lib/tones";

import { ApplicationHeader } from "../applications/[id]/application-header";
import { FitColumn, FitPanel, type GapActions } from "../applications/[id]/fit-column";

import type { Details } from "./new-application";

const TONE_OPTIONS = Object.values(Tone).map((tone) => ({ value: tone, label: TONES[tone].label }));
const WRITE_LABELS: Record<DocumentsToWrite, string> = { both: "Resume and letter", resume: "Resume", letter: "Cover letter" };
const WRITE_OPTIONS = DOCUMENTS_TO_WRITE.map((value) => ({ value, label: WRITE_LABELS[value] }));
/** The main button, for what's asked. */
const WRITE_BUTTON: Record<DocumentsToWrite, string> = { both: "Write resume and letter", resume: "Write the resume", letter: "Write the letter" };

/** The read-out's fields, in its three columns. */
const READ_OUT: { field: Exclude<keyof Details, "title">; label: string }[] = [
  { field: "company", label: "Company" },
  { field: "role", label: "Role" },
  { field: "deadline", label: "Apply by" },
  { field: "location", label: "Location" },
  { field: "mode", label: "Work mode" },
  { field: "salary", label: "Salary" },
];

/** "Apply by Thu 19 Nov · in 3 days" for a Draft with this deadline, as the application will say it. */
function deadlineFlag(deadline: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const now = new Date();
  return applicationFlag(
    { status: "DRAFT", deadline: new Date(`${deadline}T00:00:00Z`), sentAt: null, lastStatusChange: null, updatedAt: now, nextInterviewAt: null },
    { now, quietDays: 0 },
  );
}

const card = "rounded-[14px] border border-line-card bg-card";

/**
 * New application's review, in the application's own frame (E31-3, design
 * 6a2): the header with the title and its flag, "Before writing" before the
 * tabs to come, the Fit column from the reading, then what was read, how to
 * write it, and *Write resume and letter*. While the posting is read, its
 * steps show in the middle.
 */
export function ReviewStep({
  details,
  onDetails,
  posting,
  postingUrl,
  match,
  requirements,
  profileName,
  knownGaps,
  roles,
  gapActions,
  score,
  scoreWaits,
  reading,
  write,
  onWrite,
  tone,
  onTone,
  language,
  onLanguage,
  languages,
  note,
  onNote,
  starting,
  onStart,
  saving,
  onSave,
  onBack,
}: {
  details: Details;
  onDetails: (details: Details) => void;
  posting: string;
  postingUrl: string;
  /** Null while the posting is being read. */
  match: Match | null;
  requirements: Requirement[];
  /** "5 of 7 covered by Product design" with several profiles. */
  profileName: string;
  knownGaps: readonly string[];
  roles: readonly { id: string; label: string }[];
  gapActions: GapActions;
  score: { fit: PostingFit | null; scoring: boolean; step: string | null; onScore: () => void };
  /** Why the posting wasn't compared with the profile (#518), in place of How you fit. */
  scoreWaits?: { message: string; href: string };
  /** The reading's progress, in place of the review while it runs. */
  reading: ReactNode;
  write: DocumentsToWrite;
  onWrite: (write: DocumentsToWrite) => void;
  tone: Tone;
  onTone: (tone: Tone) => void;
  /** "" for the default. */
  language: string;
  onLanguage: (language: string) => void;
  /** What the default is: "English, like the posting". */
  languages: { fallback: string };
  note: string;
  onNote: (note: string) => void;
  starting: boolean;
  onStart: () => void;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showPosting, setShowPosting] = useState(false);
  const readOut = useRef<HTMLHeadingElement>(null);
  const flag = deadlineFlag(details.deadline);
  const ready = match !== null;
  const edit = () => {
    setEditing(true);
    readOut.current?.scrollIntoView?.({ block: "nearest" });
    // The first field, once it's there.
    requestAnimationFrame(() => readOut.current?.closest("section")?.querySelector<HTMLInputElement>("input")?.focus());
  };
  const startButton = (className?: string) => (
    <Button className={className} aria-disabled={!ready || starting || undefined} onClick={() => ready && !starting && onStart()}>
      <Sparkles size={15} aria-hidden="true" />
      {starting ? "Starting…" : WRITE_BUTTON[write]}
    </Button>
  );

  return (
    <div className="@container/page flex flex-1 flex-col">
      <div className="flex flex-1 flex-col @min-[780px]/page:h-panel @min-[780px]/page:flex-none">
        <ApplicationHeader
          role={ready ? details.role : ""}
          company={ready ? details.company : ""}
          title={ready ? details.title : "New application"}
          status="DRAFT"
          flag={flag}
          crumb={{
            label: "New",
            href: "/new?step=paste",
            onClick: (event) => {
              event.preventDefault();
              onBack();
            },
          }}
          edit={
            ready && (
              <button type="button" aria-label="Edit what I read" title="Edit what I read" onClick={edit} className="grid size-7 flex-none place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
                <Pencil size={14} aria-hidden="true" />
              </button>
            )
          }
          tabs={
            // What the application will have once it's written; only this step is here yet.
            <ol aria-label="Application" className="flex flex-wrap rounded-[9px] bg-track p-[3px] text-[13.5px]">
              <li aria-current="step" className="rounded-[7px] bg-card px-[13px] py-1.5 font-medium text-ink shadow-raised">
                Before writing
              </li>
              {["Resume", "Cover letter", "Email"].map((name) => (
                <li key={name} className="px-[13px] py-1.5 text-muted">
                  {name}
                  <span className="sr-only"> (once it&apos;s written)</span>
                </li>
              ))}
            </ol>
          }
          actions={
            <>
              {startButton()}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More actions"
                  className="grid size-[38px] place-items-center rounded-control border border-line-control text-muted hover:border-line-strong hover:text-ink data-[state=open]:border-primary data-[state=open]:text-ink"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    ⋯
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="min-w-[200px]">
                  <DropdownMenuItem onSelect={onBack}>Back to the posting</DropdownMenuItem>
                  {ready && <DropdownMenuItem onSelect={onSave}>Save it for later</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        <div className="flex min-h-0 flex-1">
          <FitColumn match={match}>
            {match && scoreWaits ? (
              <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                How you fit waits: {scoreWaits.message}{" "}
                <Link href={scoreWaits.href} className="font-medium underline underline-offset-2">
                  Choose the levels
                </Link>
              </p>
            ) : match ? (
              <div className="flex flex-col gap-5">
                <FitPanel
                  summary={<Coverage match={match} profileName={profileName} />}
                  meta={[]}
                  match={match}
                  requirements={requirements}
                  knownGaps={knownGaps}
                  roles={roles}
                  numbered={showPosting}
                  {...gapActions}
                />
                <p className="text-meta leading-relaxed text-muted">
                  Gaps aren&apos;t dealbreakers. I&apos;ll never invent experience: the important ones get addressed honestly in your letter.
                </p>
                <ScoreDetails {...score} />
              </div>
            ) : (
              <p className="text-meta text-muted">How you fit shows here once the posting is read.</p>
            )}
          </FitColumn>

          <div className="min-w-0 flex-1 overflow-y-auto bg-canvas px-4 py-7 sm:px-8">
            <div className="mx-auto flex max-w-[820px] flex-col gap-4">
              {!match ? (
                reading
              ) : (
                <>
                  <section aria-labelledby="read-out" className={cn(card, "flex flex-col gap-4 px-6 py-5")}>
                    <div className="flex items-baseline justify-between gap-3">
                      {/* Takes focus when the review starts (E11-3). */}
                      <h2 id="read-out" ref={readOut} tabIndex={-1} className="text-[15px] font-medium">
                        What I read from the posting
                      </h2>
                      <button type="button" className="text-[13px] text-muted underline underline-offset-[3px] hover:text-ink" onClick={() => (editing ? setEditing(false) : edit())}>
                        {editing ? "Done" : "Edit"}
                      </button>
                    </div>
                    {editing ? (
                      <ReadOutFields details={details} onChange={onDetails} />
                    ) : (
                      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-3">
                        {READ_OUT.map(({ field, label }) => {
                          const value = field === "deadline" ? (flag ? flag.text.replace(/^Apply by /, "") : "") : details[field];
                          return (
                            <div key={field} className="flex min-w-0 flex-col gap-0.5">
                              <dt className="text-meta text-muted">{label}</dt>
                              <dd className={cn("text-[15px]", !value ? "text-muted" : field === "deadline" && flag?.soon ? "text-warning" : "text-ink")}>{value || "Not in the posting"}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                    <p className="border-t border-line pt-3 text-meta text-muted">
                      What the posting doesn&apos;t say stays empty. Nothing is guessed.{" · "}
                      <button type="button" aria-expanded={showPosting} className="text-ink underline underline-offset-[3px]" onClick={() => setShowPosting(!showPosting)}>
                        {showPosting ? "Hide the posting" : "Show the posting"}
                      </button>
                    </p>
                  </section>

                  {showPosting && <PostingCard posting={posting} postingUrl={postingUrl} match={match} onHide={() => setShowPosting(false)} />}

                  <HowToWrite write={write} onWrite={onWrite} tone={tone} onTone={onTone} language={language} onLanguage={onLanguage} fallback={languages.fallback} note={note} onNote={onNote} />

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
                    {startButton("min-h-10 px-4 text-field")}
                    <span className="text-[13px] text-muted">About a minute. You can leave: it keeps going.</span>
                    <span className="ml-auto text-[13px] text-muted">
                      Not applying?{" "}
                      <button type="button" aria-disabled={saving || undefined} className="text-ink underline underline-offset-[3px]" onClick={() => !saving && onSave()}>
                        {saving ? "Saving…" : "Save it for later"}
                      </button>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The top of the Fit column before writing: coverage, never a score out of 100 (U1). */
function Coverage({ match, profileName }: { match: Match; profileName: string }) {
  const { hit, total } = matchScore(match);
  return (
    <div className="flex items-center gap-3.5">
      <ScoreRing hit={hit} total={total} size="lg" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[15px] font-medium text-ink">{total > 0 ? coverageBand(match) : "No requirements found"}</p>
        <p className="text-meta text-muted">
          {total > 0 ? `${hit} of ${total} covered` : "The posting doesn't list any"}
          {profileName && ` by ${profileName}`}
        </p>
      </div>
    </div>
  );
}

/** The posting's score with its reasons (public issue 66), folded away under the requirements. */
function ScoreDetails({ fit, scoring, step, onScore }: { fit: PostingFit | null; scoring: boolean; step: string | null; onScore: () => void }) {
  return (
    <details className="border-t border-line pt-4">
      <summary className="cursor-pointer text-meta text-muted hover:text-ink">{fit ? "How it fits, in more ways · Why?" : "How it fits, in more ways"}</summary>
      <div className="mt-3 flex flex-col gap-3">
        {scoring ? (
          <p role="status" className="text-meta text-muted">
            {step ?? "Starting…"}
          </p>
        ) : (
          fit && <FitDetails fit={fit} />
        )}
        <Button variant="secondary" size="sm" className="self-start" aria-disabled={scoring || undefined} onClick={() => !scoring && onScore()}>
          {scoring ? "Scoring…" : fit ? "Score it again" : "Score it"}
        </Button>
      </div>
    </details>
  );
}

/** The read-out as fields, with the title, after Edit. */
function ReadOutFields({ details, onChange }: { details: Details; onChange: (details: Details) => void }) {
  const set = (field: keyof Details, value: string) => onChange({ ...details, [field]: value });
  return (
    <div className="grid grid-cols-1 gap-x-[18px] gap-y-4 sm:grid-cols-3">
      <Input className="sm:col-span-3" label="Title" hint="Suggested by AI. Change it if you like." value={details.title} onChange={(event) => set("title", event.target.value)} />
      {READ_OUT.map(({ field, label }) =>
        field === "deadline" ? (
          <Input key={field} label={label} type="date" value={details.deadline} onChange={(event) => set("deadline", event.target.value)} />
        ) : (
          <Input key={field} label={label} placeholder="Not in the posting" value={details[field]} onChange={(event) => set(field, event.target.value)} />
        ),
      )}
    </div>
  );
}

const MARK: Record<MatchResult, string> = {
  covered: "bg-success/18 border-success",
  partial: "bg-warning/18 border-warning",
  gap: "bg-warning/18 border-warning",
};

/** The posting as pasted, each requirement marked where it says it, numbered as in How you fit (design 6b). */
function PostingCard({ posting, postingUrl, match, onHide }: { posting: string; postingUrl: string; match: Match; onHide: () => void }) {
  const heading = useId();
  const highlights = useMemo(() => postingHighlights(posting, match.items.map((item) => item.requirement)), [posting, match]);
  const words = posting.trim().split(/\s+/).length;
  let site = "";
  try {
    site = postingUrl ? new URL(/^https?:\/\//i.test(postingUrl) ? postingUrl : `https://${postingUrl}`).hostname.replace(/^www\./, "") : "";
  } catch {
    // Not a link.
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (const { start, end, index } of highlights) {
    if (start > at) parts.push(posting.slice(at, start));
    const result = match.items[index].result;
    parts.push(
      <span key={start}>
        <mark className={cn("rounded-[2px] border-b-2 px-px text-ink", MARK[result])}>
          <span className="sr-only">{result === "covered" ? "(covered) " : "(a gap) "}</span>
          {posting.slice(start, end)}
        </mark>
        <sup className="ml-0.5 text-[10px] text-muted">{index + 1}</sup>
      </span>,
    );
    at = end;
  }
  parts.push(posting.slice(at));
  return (
    <section aria-labelledby={heading} className={cn(card, "flex flex-col gap-4 px-6 py-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={heading} className="text-meta text-muted">
          The posting · {words} {words === 1 ? "word" : "words"}
          {site && ` · from ${site}`}
        </h2>
        <span className="flex items-center gap-2 text-meta">
          <span className="rounded-[4px] bg-success/18 px-1.5 text-ink">covered</span>
          <span className="rounded-[4px] bg-warning/18 px-1.5 text-ink">a gap</span>
          <button type="button" className="ml-1 text-muted hover:text-ink" onClick={onHide}>
            Hide
          </button>
        </span>
      </div>
      <div className="font-serif text-[15.5px] leading-[1.75] whitespace-pre-wrap text-ink">{parts}</div>
      {highlights.length < match.items.length && (
        <p className="border-t border-line pt-3 text-meta text-muted">
          {highlights.length === 0 ? "None of the requirements are" : `${match.items.length - highlights.length} of the requirements aren't`} marked: they&apos;re worded differently in the posting.
        </p>
      )}
    </section>
  );
}

/** "How to write it" (E31-3, design 6a2): what to write, the letter's tone, its language, and a note kept as a fact. */
function HowToWrite({
  write,
  onWrite,
  tone,
  onTone,
  language,
  onLanguage,
  fallback,
  note,
  onNote,
}: {
  write: DocumentsToWrite;
  onWrite: (write: DocumentsToWrite) => void;
  tone: Tone;
  onTone: (tone: Tone) => void;
  language: string;
  onLanguage: (language: string) => void;
  fallback: string;
  note: string;
  onNote: (note: string) => void;
}) {
  const heading = useId();
  const writeId = useId();
  const toneId = useId();
  const toneHint = useId();
  const languageId = useId();
  const row = "grid grid-cols-1 items-center gap-x-6 gap-y-2 sm:grid-cols-[150px_1fr]";
  return (
    <section aria-labelledby={heading} className={cn(card, "flex flex-col gap-5 px-6 py-5")}>
      <h2 id={heading} className="text-[15px] font-medium">
        How to write it
      </h2>
      <div className={row}>
        <span id={writeId} className="text-[13.5px] text-muted">
          Write
        </span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SegmentedControl aria-labelledby={writeId} options={WRITE_OPTIONS} value={write} onValueChange={onWrite} />
          {write !== "both" && <span className="text-meta text-muted">The other can be written later, from the application.</span>}
        </div>
      </div>
      {write !== "resume" && (
        <div className={row}>
          <span id={toneId} className="text-[13.5px] text-muted">
            Letter&apos;s tone
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SegmentedControl aria-labelledby={toneId} aria-describedby={toneHint} options={TONE_OPTIONS} value={tone} onValueChange={onTone} />
            <span id={toneHint} className="text-meta text-muted">
              {TONES[tone].description}
            </span>
          </div>
        </div>
      )}
      <div className={row}>
        <label htmlFor={languageId} className="text-[13.5px] text-muted">
          Language
        </label>
        <select
          id={languageId}
          value={language}
          onChange={(event) => onLanguage(event.target.value)}
          className="h-9 max-w-[260px] rounded-control border border-line-control bg-input px-2.5 text-sm text-ink"
        >
          <option value="">{fallback}</option>
          {DOCUMENT_LANGUAGES.filter((entry) => !fallback.startsWith(`${entry.name},`)).map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[150px_1fr]">
        <span aria-hidden="true" className="pt-2 text-[13.5px] text-muted">
          Anything I should know?
        </span>
        <Textarea
          label={<span className="sr-only">Anything I should know?</span>}
          hint="Kept with this application as a fact for the AI."
          rows={3}
          placeholder="e.g. I'm moving to Amsterdam in January, so the office days are fine."
          value={note}
          onChange={(event) => onNote(event.target.value)}
        />
      </div>
    </section>
  );
}
