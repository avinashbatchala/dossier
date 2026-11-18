"use client";

import { AlertDialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { toastWithUndo } from "@/components/change-status";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SelectControl } from "@/components/ui/select";
import type { ReplyKind } from "@/generated/prisma/enums";
import { useJob } from "@/hooks/use-job";
import { cn } from "@/lib/cn";
import {
  applySuggestedStatus,
  confirmInterview,
  linkEmail,
  loadFreeSlots,
  markHandled,
  rereadEmail,
  saveReplyDraft,
  sendReplyEmail,
  startDraftingReply,
} from "@/lib/google/actions";
import type { EmailView } from "@/lib/google/inbox-data";
import type { DraftReplyResult } from "@/lib/jobs/draft-reply";
import { statusInfo } from "@/lib/status";

// An application's mail (E15-3, E15-4, E15-5), oldest first: each message,
// what the AI read in replies, the status they suggest, a drafted answer
// with free times from the calendar, and agreed interviews.

export const KIND_LABELS: Record<ReplyKind, string> = {
  REJECTION: "Rejection",
  INTERVIEW: "Interview invite",
  QUESTION: "Question",
  OFFER: "Offer",
  ACKNOWLEDGEMENT: "Acknowledgement",
  OTHER: "Other",
};

export function formatWhen(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

type Choice = { id: string; label: string };

/**
 * Every message of a conversation; the newest unanswered reply opens with its
 * answer. With `moveTo`, a reply linked to the wrong application can be moved
 * to one of those, or unlinked (public #134).
 */
export function Conversation({ emails, moveTo, aiReady, timeZone }: { emails: EmailView[]; moveTo?: Choice[]; aiReady: boolean; timeZone?: string }) {
  const latestOpen = [...emails].reverse().find((email) => email.direction === "INCOMING" && !email.handled)?.id;
  return (
    <ol className="flex flex-col gap-3">
      {emails.map((email) => (
        <li key={email.id}>
          <Message email={email} moveTo={moveTo} aiReady={aiReady} timeZone={timeZone} initiallyOpen={email.id === latestOpen || emails.length === 1} />
        </li>
      ))}
    </ol>
  );
}

/** "LV" for Lotte de Vries; the address's first letter without a name. */
function initials(name: string): string {
  const words = name.replace(/[<>"]/g, "").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/**
 * One message as a card (E30-13, design 4c): who and when, and for an
 * employer's, the one line the AI read in it. The newest unanswered reply
 * opens with its answer.
 */
function Message({ email, moveTo, aiReady, timeZone, initiallyOpen }: { email: EmailView; moveTo?: Choice[]; aiReady: boolean; timeZone?: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const outgoing = email.direction === "OUTGOING";
  const who = outgoing ? "You" : email.fromName || email.fromAddress;
  return (
    <article className="rounded-panel border border-line-card bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 py-4 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={cn("grid size-6 flex-none place-items-center rounded-full text-[10.5px] font-semibold", outgoing ? "bg-primary text-on-primary" : "bg-track text-ink")}>
            {outgoing ? "Y" : initials(who)}
          </span>
          <span className="font-medium">{who}</span>
          {!outgoing && email.fromName && <span className="truncate text-meta text-muted">&lt;{email.fromAddress}&gt;</span>}
          {email.kind && !outgoing && <KindChip kind={email.kind} />}
          <span className="text-meta text-muted">{formatWhen(email.sentAt, timeZone)}</span>
        </span>
        {/* What it asks for, in one line (E30-13). */}
        {!outgoing && email.read && email.summary && <span className="max-w-full min-w-0 truncate text-[12.5px] text-muted sm:max-w-[50%]">{email.summary}</span>}
      </button>
      {!open && <p className="truncate px-6 pb-4 pl-[58px] text-meta text-muted">{email.subject || email.body.slice(0, 140)}</p>}
      {open && (
        <div className="flex flex-col gap-4 px-6 pb-5">
          {email.subject && <p className="text-meta text-muted">{email.subject}</p>}
          <div className="text-field leading-[1.6] break-words whitespace-pre-wrap">{email.body || <span className="text-muted">No text.</span>}</div>
          {!outgoing && <Reading email={email} aiReady={aiReady} timeZone={timeZone} />}
          {!outgoing && moveTo && <MoveEmail email={email} moveTo={moveTo} />}
        </div>
      )}
    </article>
  );
}

/** "Not about this application?": moves the mail's thread to another application, or unlinks it. */
function MoveEmail({ email, moveTo }: { email: EmailView; moveTo: Choice[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const link = (applicationId: string | null) =>
    startTransition(async () => {
      if (toastResult(await linkEmail({ emailId: email.id, applicationId })).ok) router.refresh();
    });
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <span className="text-meta text-muted">Not about this application?</span>
      {moveTo.length > 0 && (
        <>
          <SelectControl
            compact
            aria-label="Move to application"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            wrapperClassName="max-w-[280px] flex-1"
            className="h-[30px] w-full min-w-0 rounded-control border border-line-input bg-input text-control"
          >
            <option value="">Choose application…</option>
            {moveTo.map((application) => (
              <option key={application.id} value={application.id}>
                {application.label}
              </option>
            ))}
          </SelectControl>
          <Button size="sm" variant="secondary" disabled={!choice || pending} onClick={() => link(choice)}>
            Move
          </Button>
        </>
      )}
      <Button size="sm" variant="text" disabled={pending} onClick={() => link(null)}>
        Unlink
      </Button>
    </div>
  );
}

function KindChip({ kind }: { kind: ReplyKind }) {
  const tone =
    kind === "REJECTION" ? "bg-danger-surface text-danger" : kind === "OFFER" || kind === "INTERVIEW" ? "bg-warning-surface text-warning" : "bg-hover text-muted";
  return <span className={cn("rounded-[6px] px-2 py-[2px] text-xs", tone)}>{KIND_LABELS[kind]}</span>;
}

/** What the AI read in a reply, its suggested status and interview time, and the answer. */
function Reading({ email, aiReady, timeZone }: { email: EmailView; aiReady: boolean; timeZone?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<void>) => startTransition(work);

  if (!email.read) {
    return (
      <Panel title="Not read yet">
        <p className="text-meta text-muted">{aiReady ? "The AI hasn't read this one yet." : "With an AI provider, I'd read this and draft an answer."}</p>
        {aiReady && (
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={pending}
            onClick={() =>
              run(async () => {
                if (toastResult(await rereadEmail({ emailId: email.id })).ok) router.refresh();
              })
            }
          >
            {pending ? "Reading…" : "Read it now"}
          </Button>
        )}
      </Panel>
    );
  }

  const suggest = (accept: boolean) =>
    run(async () => {
      const result = await applySuggestedStatus({ emailId: email.id, accept });
      if (!result.ok) return toast(result.error);
      toastWithUndo(result.toast, result.data.eventId);
      router.refresh();
    });

  return (
    <>
      {/* What it says is the card's one line (E30-13); what they ask, and the status it suggests, stay here. */}
      {(email.questions.length > 0 || (email.suggestedStatus && email.application)) && (
      <Panel title="What they ask">
        {email.questions.length > 0 && (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-meta text-muted">
            {email.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        )}
        {email.suggestedStatus && email.application && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="mr-auto text-meta">Move to {statusInfo(email.suggestedStatus).label}?</span>
            <Button variant="text" size="sm" disabled={pending} onClick={() => suggest(false)}>
              Not now
            </Button>
            <Button variant="secondary" size="sm" disabled={pending} onClick={() => suggest(true)}>
              Move to {statusInfo(email.suggestedStatus).label}
            </Button>
          </div>
        )}
      </Panel>
      )}
      {email.confirmedAt && email.application && <InterviewConfirm email={email} timeZone={timeZone} />}
      {!email.handled ? (
        <ReplyDraft email={email} aiReady={aiReady} />
      ) : (
        <p className="text-meta text-muted">
          {email.kind === "ACKNOWLEDGEMENT" || email.kind === "REJECTION" ? "No answer needed." : "Answered."}{" "}
          <button
            type="button"
            className="underline underline-offset-3 hover:text-ink"
            onClick={() =>
              run(async () => {
                if (toastResult(await markHandled({ emailId: email.id, handled: false })).ok) router.refresh();
              })
            }
          >
            Answer anyway
          </button>
        </p>
      )}
    </>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-line bg-canvas px-4 py-3.5">
      <h3 className="text-label text-muted">{title}</h3>
      {children}
    </section>
  );
}

/** An agreed interview time: to the calendar and the dashboard, and the status to Interview. */
function InterviewConfirm({ email, timeZone }: { email: EmailView; timeZone?: string }) {
  const router = useRouter();
  const [move, setMove] = useState(email.application?.status !== "INTERVIEW");
  const [pending, startTransition] = useTransition();
  const confirm = () =>
    startTransition(async () => {
      const result = await confirmInterview({ emailId: email.id, start: email.confirmedAt!.toISOString(), moveToInterview: move });
      if (!result.ok) return toast(result.error);
      toastWithUndo(result.toast, result.data.eventId);
      router.refresh();
    });
  return (
    <Panel title={`Interview on ${formatWhen(email.confirmedAt!, timeZone)}`}>
      <p className="text-meta text-muted">They settled on this time. Add it to your calendar and dashboard?</p>
      {email.application?.status !== "INTERVIEW" && <Checkbox label="Move to Interview too" checked={move} onChange={(event) => setMove(event.target.checked)} />}
      <div className="flex justify-end">
        <Button size="sm" disabled={pending} onClick={confirm}>
          {pending ? "Adding…" : "Add interview"}
        </Button>
      </div>
    </Panel>
  );
}

type Slot = { start: string; label: string };

/** The drafted answer: free times to pick, gaps to fill, a note to the AI, and Send. */
function ReplyDraft({ email, aiReady }: { email: EmailView; aiReady: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState(email.replyDraft);
  // Once there's a draft, the box stays, even emptied.
  const [drafted, setDrafted] = useState(email.replyDraft !== "");
  const [gaps, setGaps] = useState(email.replyGaps);
  const [note, setNote] = useState("");
  const [job, setJob] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const answer = useRef<HTMLTextAreaElement>(null);
  const wantsSlots = email.kind === "INTERVIEW" && !email.confirmedAt;

  // Free times, when they ask to meet.
  useEffect(() => {
    if (!wantsSlots) return;
    let stale = false;
    void loadFreeSlots({}).then((result) => {
      if (stale) return;
      // Without the calendar (or when Google can't be reached), offer no times rather than wait.
      if (!result.ok) return setSlots([]);
      setSlots(result.data.slots);
      setPicked(result.data.slots.slice(0, 3).map((slot) => slot.start));
    });
    return () => {
      stale = true;
    };
  }, [wantsSlots]);

  const drafting = useJob<DraftReplyResult>(job, 0, (update) => {
    if (update.status === "FAILED") {
      setJob(null);
      toast(update.error ?? "That didn't work. Try again.");
    } else if (update.status === "DONE" && update.result) {
      setJob(null);
      setBody(update.result.body);
      setDrafted(true);
      setGaps(update.result.gaps);
      setNote("");
      router.refresh();
    }
  });

  const draft = () =>
    startTransition(async () => {
      if (!aiReady) return toast("That needs an AI provider. Choose one in Settings → AI provider.");
      const result = await startDraftingReply({ emailId: email.id, note, slots: wantsSlots && slots ? picked : null });
      if (!result.ok) return toast(result.error);
      setJob(result.data);
    });

  const send = () =>
    startTransition(async () => {
      setConfirming(false);
      const result = await sendReplyEmail({ emailId: email.id, body });
      if (!toastResult(result).ok) return;
      router.refresh();
    });

  const skip = () =>
    startTransition(async () => {
      if (toastResult(await markHandled({ emailId: email.id, handled: true })).ok) router.refresh();
    });

  const busy = job !== null || pending;
  const missing = /\[…\]|\[\.\.\.\]/.test(body);
  const fromCalendar = wantsSlots && slots !== null && slots.length > 0;
  return (
    // The AI's draft stands out from the mail around it (E30-13).
    <section className="flex flex-col gap-3 rounded-card border border-line-strong bg-card px-4 py-4" aria-busy={job !== null || undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-baseline gap-2 text-[15px] font-medium">
          <span aria-hidden className="text-muted">
            ✦
          </span>
          Draft answer
          {fromCalendar && <span className="text-meta font-normal text-muted">Written from your calendar</span>}
        </h3>
        {job ? (
          <span className="text-meta text-muted">{drafting?.step ?? "Starting…"}</span>
        ) : (
          fromCalendar && <span className="text-meta text-muted">{picked.length === 1 ? "1 time you're free" : `${picked.length} times you're free`}</span>
        )}
      </div>

      {wantsSlots && (
        <div className="flex flex-col gap-2">
          <span className="text-label text-muted">{slots === null ? "Looking at your calendar…" : slots.length > 0 ? "Times to offer, from your calendar" : "No calendar times: connect Google Calendar in Settings to offer some"}</span>
          {slots && slots.length > 0 && (
            <div role="group" aria-label="Times to offer" className="flex flex-wrap gap-1.5">
              {slots.map((slot) => {
                const on = picked.includes(slot.start);
                return (
                  <button
                    key={slot.start}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPicked(on ? picked.filter((entry) => entry !== slot.start) : [...picked, slot.start])}
                    className={cn(
                      "rounded-control border px-2.5 py-1.5 text-control",
                      on ? "border-primary bg-selected font-medium" : "border-line-field bg-input text-muted hover:border-line-strong",
                    )}
                  >
                    {slot.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {drafted || body ? (
        <textarea
          ref={answer}
          aria-label="Your answer"
          value={body}
          rows={Math.min(18, Math.max(6, body.split("\n").length + 1))}
          onChange={(event) => setBody(event.target.value)}
          onBlur={() => body !== email.replyDraft && void saveReplyDraft({ emailId: email.id, body }).then(toastResult)}
          className={cn(
            "w-full resize-y rounded-control border border-line-input bg-input px-3 py-2.5 text-field leading-[1.6] focus-visible:border-primary focus-visible:outline-offset-0",
            job && "opacity-50",
          )}
        />
      ) : (
        <p className="text-meta text-muted">I&apos;ll answer from your profile and this application, and only with facts that are in them.</p>
      )}

      {gaps.length > 0 && (
        <div role="note" className="flex flex-col gap-1 rounded-card bg-warning-surface px-3.5 py-2.5 text-meta text-warning">
          <span className="font-medium">Your profile doesn&apos;t say:</span>
          <ul className="list-disc pl-5">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          <span>Fill in the […] above, or tell me below and draft again.</span>
        </div>
      )}

      <div className="flex gap-2">
        <input
          aria-label="Tell the AI"
          value={note}
          placeholder={body ? "e.g. My notice period is 3 months; make it shorter" : "Anything to add? e.g. My notice period is 3 months"}
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (!busy) draft();
            }
          }}
          className="h-[34px] min-w-0 flex-1 rounded-control border border-line-input bg-input px-3 text-sm placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
        />
        {!(drafted || body) && (
          <Button variant="secondary" disabled={busy} onClick={draft}>
            {job ? "Drafting…" : "Draft an answer"}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {(drafted || body) && (
          <>
            <Button
              aria-disabled={busy || !body.trim() || undefined}
              onClick={() => {
                if (busy || !body.trim()) return;
                if (missing) return toast("Fill in the parts marked […] first.");
                setConfirming(true);
              }}
            >
              <Send size={15} aria-hidden="true" />
              Send reply
            </Button>
            <Button variant="secondary" onClick={() => answer.current?.focus()}>
              Edit
            </Button>
            <Button variant="text" disabled={busy} onClick={draft}>
              {job ? "Writing…" : "Write it again"}
            </Button>
          </>
        )}
        <Button variant="text" size="sm" className="ml-auto" disabled={busy} onClick={skip}>
          No answer needed
        </Button>
      </div>

      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
            <AlertDialog.Title className="font-serif text-[22px] leading-tight">Send your answer?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted">
              To {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress}, in the same thread. This can&apos;t be unsent.
            </AlertDialog.Description>
            <div className="min-h-0 overflow-auto rounded-control border border-line bg-canvas px-4 py-3 text-control leading-[1.6] whitespace-pre-wrap">{body}</div>
            <div className="mt-2 flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonClassName("secondary", "sm")}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action className={buttonClassName("primary", "sm", "hover:text-on-primary")} onClick={send}>
                Send now
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
