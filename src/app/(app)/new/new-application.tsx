"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Tone } from "@/generated/prisma/enums";
import { useJob } from "@/hooks/use-job";
import type { DocumentsToWrite } from "@/lib/settings";
import { withSkillAdded, type Extracted } from "@/lib/application-data";
import type { PostingFit } from "@/lib/fit";
import { cancel, retry } from "@/lib/jobs/actions";
import { READ_POSTING_STEPS } from "@/lib/jobs/application-steps";
import type { ReadPostingResult } from "@/lib/jobs/read-posting";

import { openPendingTab, sendPendingTab } from "@/lib/claude-tab";


import { addGapSkill, fetchPostingText, handOffToClaude, savePostingForLater, startReadingPosting, startScoringPosting, startWritingApplication } from "./actions";
import { AlreadySent } from "./already-sent";
import { createDraftStore } from "./draft-store";
import { PasteStep, type StartFrom } from "./paste-step";
import { ReviewStep } from "./review-step";
import type { GapAnswer } from "../applications/[id]/fit-column";
import { JobProgress, jobStep } from "./job-progress";

/** The editable details of "The application" (NEW-3). */
export type Details = {
  title: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  salary: string;
  /** YYYY-MM-DD or empty. */
  deadline: string;
};

/** Everything the flow knows so far; nothing reaches the server as an application until the end. */
export type Draft = {
  step: "paste" | "reading" | "review";
  posting: string;
  postingUrl: string;
  readJobId: string | null;
  /** The posting text that was read, so going back and on again doesn't read it twice. */
  readFor: string | null;
  read: ReadPostingResult | null;
  details: Details;
  tone: Tone;
  note: string;
  /** Which documents to write (#367); missing in drafts from before, which wrote both. */
  write?: DocumentsToWrite;
  /** The documents' language (E31-3); "" or missing for Settings', else the posting's. */
  language?: string;
  /** Requirements marked "I don't have this" before writing (E30-5). */
  knownGaps?: string[];
  /** The Find jobs posting it was started from (E14-8); missing in drafts from before. */
  postingId?: string | null;
  /** The startup it was started from with "Write to them" (#222). */
  startupId?: string | null;
  /** "Score it" (public issue 66): the job scoring the posting, and its score; missing in drafts from before. */
  scoreJobId?: string | null;
  score?: PostingFit | null;
  /** The profile it's made from (E24-6); missing in drafts from before, which use the default. */
  profileId?: string | null;
};

/** A posting handed over by "Start application" on Find jobs (E14-8), or by "Write to them" on Startups (#222). */
type FromPosting = {
  /** The Find jobs posting; null for a startup. */
  id: string | null;
  /** The startup and its name, from Startups. */
  startup?: { id: string; company: string };
  text: string;
  url: string;
  /** False when only the start of the posting came through. */
  complete: boolean;
};

function detailsFrom(extracted: Extracted): Details {
  return {
    title: extracted.title ?? "",
    company: extracted.company ?? "",
    role: extracted.role ?? "",
    location: extracted.location ?? "",
    mode: extracted.mode ?? "",
    salary: extracted.salary ?? "",
    deadline: extracted.deadline ?? "",
  };
}

const EMPTY_DETAILS: Details = { title: "", company: "", role: "", location: "", mode: "", salary: "", deadline: "" };

// One draft per tab, in sessionStorage (E7-7); none while rendering on the server.
const draftStore = typeof window === "undefined" ? null : createDraftStore<Draft>();
const noStore = () => () => {};

const LEAVE_WARNING = "Leave now? I'll stop reading the posting.";

/**
 * While `active`, leaving the page asks first (E7-7): the browser's own
 * prompt for closing or reloading, a confirm for links inside the app. A
 * confirmed in-app leave calls `onLeave`.
 */
function useLeaveGuard(active: boolean, onLeave: () => void) {
  const leave = useRef(onLeave);
  useLayoutEffect(() => {
    leave.current = onLeave;
  });
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const click = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.href === window.location.href) return;
      if (!window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      leave.current();
    };
    window.addEventListener("beforeunload", beforeUnload);
    // Capture, so it runs before Next.js' own link handling.
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active]);
}

export type NewApplicationProps = {
  /** Whether an AI provider is set up; without one, the page points to Settings. */
  aiReady: boolean;
  /** The Claude connector is on and Dossier has no usable AI model: a Claude chat writes it instead (#221). */
  writeInClaude?: boolean;
  /** Offered through "Use a sample posting" before the first application. */
  samplePosting: string | null;
  /** Settings → default cover letter tone (SET-6). */
  defaultTone: Tone;
  /** Settings → Documents to write (#367). */
  defaultWrite?: DocumentsToWrite;
  /** "+ New application": start over, whatever the tab kept. */
  fresh?: boolean;
  /** "Start application" on Find jobs: start over from this posting. */
  fromPosting?: FromPosting | null;
  /** Every profile, and the one to start with: the one last opened (E24-6). */
  profiles?: { id: string; name: string }[];
  defaultProfileId?: string;
  /** "Or start from one you saved" (E31-2). */
  startFrom?: readonly StartFrom[];
  /** Each profile's roles, for "Where you used it" on a gap (E30-5). */
  roles?: Readonly<Record<string, readonly { id: string; label: string }[]>>;
  /** Settings → Documents' language, or null to follow the posting (E31-3). */
  docLanguage?: string | null;
};

/** The two steps with a URL of their own (E31-1, public 111): `/new?step=paste|review`. */
type UrlStep = "paste" | "review";

/** Moves to a step with a history entry of its own, so Back and Forward move between steps. */
function pushStep(step: UrlStep) {
  window.history.pushState(null, "", `/new?step=${step}`);
}

/** The new application flow (E7): paste → read → review → create. */
export function NewApplication({
  aiReady,
  writeInClaude = false,
  samplePosting,
  defaultTone,
  defaultWrite = "both",
  fresh = false,
  fromPosting = null,
  profiles = [],
  defaultProfileId,
  startFrom = [],
  roles = {},
  docLanguage = null,
}: NewApplicationProps) {
  const [initial] = useState<Draft>(() => ({
    step: "paste",
    posting: "",
    postingUrl: "",
    readJobId: null,
    readFor: null,
    read: null,
    details: EMPTY_DETAILS,
    tone: defaultTone,
    note: "",
    write: defaultWrite,
    postingId: null,
  }));
  // The server renders a fresh draft; the tab's own draft takes over once the page is live.
  const stored = useSyncExternalStore(draftStore?.subscribe ?? noStore, () => draftStore?.get() ?? null, () => null);
  const draft = stored ?? initial;
  // Set when a change here moves to another step; the tab's draft taking over on load doesn't count.
  const stepChanged = useRef(false);
  const setDraft = (next: (current: Draft) => Draft) => {
    const current = draftStore?.get() ?? initial;
    const updated = next(current);
    if (updated.step !== current.step) stepChanged.current = true;
    draftStore?.set(updated);
  };
  /** Moves to another step: the draft's, and the URL's with a history entry. */
  const goTo = (patch: Partial<Draft> & { step: Draft["step"] }) => {
    stepChanged.current = true;
    setDraft((current) => ({ ...current, ...patch }));
    const target: UrlStep = patch.step === "paste" ? "paste" : "review";
    if (target !== urlStep) pushStep(target);
  };
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  // The profile it's made from (E24-6): the draft's, if it's still there, else the default.
  const profileId = profiles.some((entry) => entry.id === draft.profileId) ? draft.profileId! : defaultProfileId;

  const router = useRouter();
  // The step on screen is the URL's (E31-1); reading and the review share `?step=review`.
  const urlStep: UrlStep = useSearchParams().get("step") === "review" ? "review" : "paste";
  const reviewable = draft.step !== "paste" && (draft.step !== "review" || draft.read !== null);
  const step: Draft["step"] = urlStep === "review" && reviewable ? draft.step : "paste";
  // `?step=review` with nothing read yet, e.g. Forward after starting over: the paste step's URL instead.
  const live = useSyncExternalStore(noStore, () => true, () => false);
  useEffect(() => {
    if (live && urlStep === "review" && !reviewable) window.history.replaceState(null, "", "/new?step=paste");
  }, [live, urlStep, reviewable]);
  useEffect(() => {
    if (!fresh) return;
    draftStore?.clear();
    router.replace("/new");
  }, [fresh, router]);
  // E14-8: a posting from Find jobs replaces the tab's draft, as "+ New
  // application" would, at the paste step, to check before reading it.
  useEffect(() => {
    if (!fromPosting) return;
    draftStore?.set({ ...initial, posting: fromPosting.text, postingUrl: fromPosting.url, postingId: fromPosting.id, startupId: fromPosting.startup?.id ?? null });
    toast(
      fromPosting.startup
        ? `Here's what Startups knows about ${fromPosting.startup.company}, without its addresses. Add the role you're after if it doesn't say, then read it.`
        : fromPosting.complete
          ? "Here's the posting from Find jobs. Check it, then read it."
          : "Only the start of this posting came through. Paste the rest from the posting's page, then read it.",
    );
    router.replace("/new");
  }, [fromPosting, initial, router]);
  const [starting, setStarting] = useState(false);
  const [fetching, setFetching] = useState(false);
  // "Already sent it?" (public #129), open under the paste step.
  const [alreadySent, setAlreadySent] = useState(false);
  const [readRevision, setReadRevision] = useState(0);

  // E11-3: a new step replaces the controls of the last one, so focus moves to
  // its heading (or the posting field) instead of getting lost.
  const stepArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!stepChanged.current) return;
    stepChanged.current = false;
    stepArea.current?.querySelector<HTMLElement>("h2[tabindex], textarea")?.focus();
  }, [step]);

  // Reading ends on its own; move on to the review with what it found (E7-2).
  const readJob = useJob<ReadPostingResult>(draft.readJobId, readRevision, (job) => {
    if (job.status !== "DONE" || !job.result) return;
    const read = job.result;
    setDraft((current) =>
      current.step === "reading" && current.readJobId === job.id
        ? { ...current, step: "review", read, details: detailsFrom(read.extracted) }
        : current,
    );
  });

  const readPosting = async () => {
    if (!draft.posting.trim()) {
      toast(samplePosting ? "Paste a job posting first, or try the sample." : "Paste a job posting first.");
      return;
    }
    // Back and on again with the same posting: keep what was read and edited.
    if (draft.read && draft.readFor === draft.posting.trim()) {
      goTo({ step: "review" });
      return;
    }
    setStarting(true);
    const result = toastResult(await startReadingPosting({ posting: draft.posting, profileId, postingId: draft.postingId ?? null }));
    setStarting(false);
    if (result.ok) goTo({ step: "reading", readJobId: result.data, readFor: draft.posting.trim(), read: null, scoreJobId: null, score: null });
  };

  // Public issue 66: the posting's score, with its reasons, before anything is written.
  const scoreJob = useJob<PostingFit>(draft.scoreJobId ?? null, 0, (job) => {
    if (job.status !== "DONE" && job.status !== "FAILED") return;
    if (job.status === "FAILED") toast(job.error ?? "The posting couldn't be scored.");
    update({ scoreJobId: null, ...(job.status === "DONE" && job.result ? { score: job.result } : {}) });
  });
  const scoring = Boolean(draft.scoreJobId) && (!scoreJob || scoreJob.status === "QUEUED" || scoreJob.status === "RUNNING");
  const scoreIt = async () => {
    if (scoring) return;
    const { title, company, location, mode, salary } = draft.details;
    const result = toastResult(await startScoringPosting({ posting: draft.posting, details: { title, company, location, mode, salary }, profileId }));
    if (result.ok) update({ scoreJobId: result.data });
  };

  // #221: Claude chat writes it on the user's own Claude plan, through the
  // connector, and saves it here as a Draft application.
  const writeWithClaude = async () => {
    if (!draft.posting.trim()) return toast("Paste a job posting first.");
    // Opened now, while the click still counts: a tab opened after waiting is blocked as a pop-up.
    const chat = openPendingTab();
    setStarting(true);
    const result = toastResult(await handOffToClaude({ posting: draft.posting, postingUrl: draft.postingUrl, profileId }));
    setStarting(false);
    if (!result.ok) return void chat?.close();
    sendPendingTab(chat, result.data.url);
    toast("Writing it in Claude. It shows up under Applications as a Draft once Claude has saved it.");
  };

  // E7-8: the posting's text from its link, to check before reading it.
  const fetchFromLink = async () => {
    if (!draft.postingUrl.trim()) return toast("Enter the link to the posting first.");
    setFetching(true);
    const result = toastResult(await fetchPostingText({ link: draft.postingUrl }));
    setFetching(false);
    if (!result.ok) return;
    const previous = draft.posting;
    update({ posting: result.data.text });
    const site = new URL(result.data.url).hostname.replace(/^www\./, "");
    toast(
      result.data.doubtful
        ? `What came back from ${site} looks like menus or links, not a job posting. Check it, or paste the posting instead.`
        : `Fetched the posting from ${site}. Check it before reading it.`,
      previous.trim() ? { action: { label: "Undo", onClick: () => update({ posting: previous }) } } : {},
    );
  };

  // E30-5 before writing: a gap's skill goes into the profile, with the role it was used in; the row is covered, or partly.
  const addToProfile = async (index: number, skill: string, answer: GapAnswer): Promise<boolean> => {
    const result = toastResult(await addGapSkill({ profileId, name: skill, experienceId: answer.experienceId, did: answer.did }));
    if (!result.ok) return false;
    const { name, where, experienceId } = result.data;
    setDraft((current) => {
      if (!current.read) return current;
      const items = current.read.match.items.map((item, position) =>
        position !== index ? item : experienceId ? { ...item, result: "covered" as const, skill: name, experienceIds: [experienceId], note: where ? `At ${where}` : "In a role" } : withSkillAdded(item, name),
      );
      return { ...current, read: { ...current.read, match: { items } } };
    });
    toast(experienceId ? `Added “${name}” to your profile, at ${where || "that role"}.` : `Added “${name}” to your skills. Attach it to a role under Experience to make it count.`);
    return true;
  };
  // "I don't have this": kept with the application once it's made.
  const knownGap = (requirement: string) => {
    setDraft((current) => ({ ...current, knownGaps: [...new Set([...(current.knownGaps ?? []), requirement])] }));
    toast("Noted: you don't have this. I won't suggest adding it.");
  };

  // Done with the draft: it's cleared once the page has gone, so it doesn't show the paste step on the way out.
  const leaving = useRef(false);
  useEffect(
    () => () => {
      if (leaving.current) draftStore?.clear();
    },
    [],
  );

  // E31-4: the Draft is made on the server at once, and its documents are written into it there; it opens straight away.
  const write = async () => {
    if (!draft.read || !draft.readJobId || starting) return;
    setStarting(true);
    const result = toastResult(
      await startWritingApplication({
        readJobId: draft.readJobId,
        details: draft.details,
        match: draft.read.match,
        tone: draft.tone,
        note: draft.note,
        write: draft.write ?? "both",
        language: draft.language ?? "",
        knownGaps: draft.knownGaps ?? [],
        postingUrl: draft.postingUrl,
        postingId: draft.postingId ?? null,
        startupId: draft.startupId ?? null,
      }),
    );
    if (!result.ok) return setStarting(false);
    // The application's own URL from here on (E31-1); the draft goes once the page has moved on.
    leaving.current = true;
    router.replace(`/applications/${result.data}${draft.write === "letter" ? "?tab=letter" : ""}`);
  };

  // "Not applying? Save it for later" (E31-3): into Positions, under Saved.
  const [saving, setSaving] = useState(false);
  const saveForLater = async () => {
    if (saving) return;
    setSaving(true);
    const { title, company, role, location, mode, salary } = draft.details;
    const result = toastResult(
      await savePostingForLater({ posting: draft.posting, postingUrl: draft.postingUrl, details: { title, company, role, location, mode, salary }, readJobId: draft.readJobId, postingId: draft.postingId ?? null }),
    );
    if (!result.ok) return setSaving(false);
    toast("Saved for later, under Saved in Positions.");
    leaving.current = true;
    router.push("/jobs?show=saved");
  };

  // Leaving while the posting is read stops it; nothing gets created.
  const working = step === "reading" && readJob?.status !== "DONE" && readJob?.status !== "FAILED";
  useLeaveGuard(working, () => {
    if (draft.readJobId) void cancel({ id: draft.readJobId });
  });

  const retryReading = async () => {
    if (!draft.readJobId) return;
    if (toastResult(await retry({ id: draft.readJobId })).ok) setReadRevision((count) => count + 1);
  };

  if (step === "paste") {
    const read = writeInClaude ? (
      <Button aria-disabled={!draft.posting.trim() || starting || undefined} onClick={() => void (starting ? undefined : writeWithClaude())}>
        Write it with Claude
      </Button>
    ) : (
      <Button
        aria-disabled={!aiReady || !draft.posting.trim() || starting || undefined}
        onClick={() => void (starting ? undefined : aiReady ? readPosting() : toast("Choose an AI provider in Settings first, or write it with Claude."))}
      >
        Read the posting
      </Button>
    );
    const link = "text-ink underline underline-offset-[3px] hover:text-ink";
    return (
      <div ref={stepArea} className="contents">
        <PasteStep
          posting={draft.posting}
          onPosting={(posting) => update({ posting })}
          postingUrl={draft.postingUrl}
          onPostingUrl={(postingUrl) => update({ postingUrl })}
          fetching={fetching}
          onFetch={() => void fetchFromLink()}
          profiles={profiles}
          profileId={profileId}
          // Another profile matches differently: what was read for the other one goes.
          onProfile={(id) => update({ profileId: id, read: null, readFor: null, score: null, scoreJobId: null })}
          action={read}
          links={
            <>
              <span>
                Already sent it?{" "}
                <button type="button" className={link} onClick={() => setAlreadySent(true)}>
                  Add it to keep track
                </button>
              </span>
              {!aiReady && !writeInClaude && (
                <span>
                  No AI provider yet?{" "}
                  <Link href="/settings?section=ai" className={link}>
                    Choose one
                  </Link>{" "}
                  or{" "}
                  <Link href="/settings?section=connector" className={link}>
                    write it with Claude
                  </Link>
                </span>
              )}
              {writeInClaude && (
                <span>
                  Rather have Dossier write it?{" "}
                  <Link href="/settings?section=ai" className={link}>
                    Choose a model
                  </Link>
                </span>
              )}
              {samplePosting && !draft.posting.trim() && (
                <button type="button" className={link} onClick={() => update({ posting: samplePosting })}>
                  Use a sample posting
                </button>
              )}
            </>
          }
          alreadySent={
            alreadySent && (
              <AlreadySent
                from={{ posting: draft.posting, postingUrl: draft.postingUrl, profileId, postingId: draft.postingId ?? null, startupId: draft.startupId ?? null }}
                initial={{ company: draft.details.company, role: draft.details.role }}
                onAdded={(id) => {
                  toast("Added to your applications.");
                  draftStore?.clear();
                  router.push(`/applications/${id}`);
                }}
                onCancel={() => setAlreadySent(false)}
              />
            )
          }
          startFrom={startFrom}
        />
      </div>
    );
  }

  const read = draft.read;
  return (
    <div ref={stepArea} className="contents">
      <ReviewStep
        details={draft.details}
        onDetails={(details) => update({ details })}
        posting={draft.posting}
        postingUrl={draft.postingUrl}
        match={step === "review" && read ? read.match : null}
        requirements={read?.extracted.requirements ?? []}
        profileName={profiles.length > 1 ? (profiles.find((entry) => entry.id === profileId)?.name ?? "") : ""}
        knownGaps={draft.knownGaps ?? []}
        roles={roles[profileId ?? ""] ?? []}
        gapActions={{ onAddSkill: addToProfile, onKnownGap: knownGap }}
        // The reading's score against the profile (E25-7), until it's scored again.
        score={{ fit: draft.score ?? read?.fit ?? null, scoring, step: scoreJob?.step ?? null, onScore: () => void scoreIt() }}
        scoreWaits={read?.scoreWaits}
        reading={
          <JobProgress
            title="Reading the posting…"
            steps={READ_POSTING_STEPS}
            current={jobStep(READ_POSTING_STEPS, readJob)}
            error={readJob?.status === "FAILED" ? readJob.error : null}
            onRetry={() => void retryReading()}
            onBack={() => goTo({ step: "paste" })}
          />
        }
        write={draft.write ?? "both"}
        onWrite={(write) => update({ write })}
        tone={draft.tone}
        onTone={(tone) => update({ tone })}
        language={draft.language ?? ""}
        onLanguage={(language) => update({ language })}
        languages={{ fallback: docLanguage ? `${docLanguage}, from Settings` : `${read?.extracted.language || "English"}, like the posting` }}
        note={draft.note}
        onNote={(note) => update({ note })}
        starting={starting}
        onStart={() => void write()}
        saving={saving}
        onSave={() => void saveForLater()}
        onBack={() => goTo({ step: "paste" })}
      />
    </div>
  );
}
