"use client";

import { useOptimistic, useState, useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatShortDay } from "@/lib/dates";
import { upcomingRound, type Prep } from "@/lib/interview-rounds";

import { addInterviewRound, tickPrep, updateInterview } from "./actions";

/** A round as the page has it (E30-6). */
export type InterviewView = {
  id: string;
  round: number;
  /** ISO, or null without a date yet. */
  at: string | null;
  minutes: number | null;
  place: string;
  people: string;
  notes: string;
  prep: Prep | null;
};

const asDate = <T extends { at: string | null }>(round: T) => ({ ...round, at: round.at ? new Date(round.at) : null });

/**
 * The Interview column (E30-6, design 4d): the next round's card, "Getting
 * ready" (written by Prepare, kept with its ticks) and "So far", the past
 * rounds and the fit in one line.
 */
export function InterviewPanel({
  applicationId,
  interviews,
  timeZone,
  inCalendar,
  preparing,
  aiReady,
  onPrepare,
  fitLine,
  onShowFit,
}: {
  applicationId: string;
  interviews: InterviewView[];
  timeZone?: string;
  /** The next interview is in Google Calendar. */
  inCalendar: boolean;
  /** "Getting ready" is being written. */
  preparing: boolean;
  aiReady: boolean;
  onPrepare: () => void;
  /** "5 of 7 requirements covered". */
  fitLine: string;
  onShowFit: () => void;
}) {
  const rounds = interviews.map(asDate);
  const upcoming = upcomingRound(rounds);
  const past = rounds.filter((round) => round !== upcoming);
  // Getting ready is for the round to come, or the latest one.
  const current = upcoming ?? rounds.at(-1) ?? null;
  const [adding, startAdding] = useTransition();

  return (
    <div className="flex flex-col gap-[18px]">
      {upcoming ? (
        <NextRound applicationId={applicationId} round={upcoming} timeZone={timeZone} inCalendar={inCalendar} />
      ) : (
        <div className="flex flex-col items-start gap-2.5 rounded-card border border-line-card bg-card px-4 py-4">
          <p className="text-sm text-muted">{rounds.length > 0 ? "No round to come yet." : "No interview date yet. Set it next to the status."}</p>
          {rounds.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              aria-disabled={adding || undefined}
              onClick={() => !adding && startAdding(async () => void toastResult(await addInterviewRound({ id: applicationId })))}
            >
              Add the next round
            </Button>
          )}
        </div>
      )}

      <GettingReady applicationId={applicationId} round={current} preparing={preparing} aiReady={aiReady} onPrepare={onPrepare} />

      <section aria-labelledby="so-far" className="flex flex-col gap-1.5 border-t border-line pt-4">
        <h2 id="so-far" className="pb-1 text-[12.5px] text-muted">
          So far
        </h2>
        {past.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {past.map((round) => (
              <li key={round.id} className="text-[13.5px]">
                <span aria-hidden="true" className="text-success">
                  ✓
                </span>{" "}
                Round {round.round}
                {round.people.trim() && ` with ${round.people.split("\n")[0]}`}
                {round.at && <span className="text-muted"> · {formatShortDay(round.at, timeZone)}</span>}
                {round.notes.trim() && <span className="block pl-4 text-meta text-muted">{round.notes.trim().split("\n")[0]}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13.5px]">
          {fitLine}
          {" · "}
          <button type="button" className="text-link underline-offset-2 hover:underline" onClick={onShowFit}>
            Show
          </button>
        </p>
      </section>
    </div>
  );
}

/** The next round's card: when in serif, how long and where, who, and its details to edit. */
function NextRound({ applicationId, round, timeZone, inCalendar }: { applicationId: string; round: ReturnType<typeof asDate<InterviewView>>; timeZone?: string; inCalendar: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-labelledby="next-round" className="flex flex-col gap-2 rounded-card border border-line-card bg-card px-4 py-4">
      <p id="next-round" className="flex items-center gap-2 text-[12.5px] text-muted">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-status-interview" />
        Next interview · round {round.round}
      </p>
      <p className="font-serif text-[26px] leading-tight">{round.at ? formatDateTime(round.at, timeZone) : "No date yet"}</p>
      {(round.minutes || round.place) && <p className="text-[13.5px]">{[round.minutes && `${round.minutes} min`, round.place].filter(Boolean).join(" · ")}</p>}
      {round.people.trim() && (
        <ul className="text-[13.5px]">
          {round.people.split("\n").filter(Boolean).map((person) => (
            <li key={person}>{person}</li>
          ))}
        </ul>
      )}
      {editing ? (
        <RoundForm applicationId={applicationId} round={round} onDone={() => setEditing(false)} />
      ) : (
        <p className="text-[12.5px] text-muted">
          {inCalendar && "In Google Calendar · "}
          <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
            Edit details
          </button>
        </p>
      )}
    </section>
  );
}

/** A round's length, place, people and notes. */
function RoundForm({ applicationId, round, onDone }: { applicationId: string; round: InterviewView | ReturnType<typeof asDate<InterviewView>>; onDone: () => void }) {
  const [minutes, setMinutes] = useState(round.minutes ? String(round.minutes) : "");
  const [place, setPlace] = useState(round.place);
  const [people, setPeople] = useState(round.people);
  const [notes, setNotes] = useState(round.notes);
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const length = Number.parseInt(minutes, 10);
      const result = toastResult(
        await updateInterview({ id: applicationId, interviewId: round.id, minutes: Number.isFinite(length) && length > 0 ? length : null, place, people, notes }),
      );
      if (result.ok) onDone();
    });
  return (
    <div role="group" aria-label={`Round ${round.round}`} className="flex flex-col gap-3 border-t border-line pt-3">
      <Input label="Length in minutes" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value.replace(/\D/g, ""))} />
      <Input label="Where" value={place} placeholder="e.g. Google Meet, or their office" onChange={(event) => setPlace(event.target.value)} />
      <Textarea label="With" hint="One person per line" rows={2} value={people} onChange={(event) => setPeople(event.target.value)} />
      <Textarea label="Notes" rows={3} value={notes} placeholder="How it went, or anything to remember" onChange={(event) => setNotes(event.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" aria-disabled={saving || undefined} onClick={() => !saving && save()}>
          Save
        </Button>
        <Button variant="text" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Getting ready": the checklist with its ticks, or Prepare. */
function GettingReady({
  applicationId,
  round,
  preparing,
  aiReady,
  onPrepare,
}: {
  applicationId: string;
  round: InterviewView | ReturnType<typeof asDate<InterviewView>> | null;
  preparing: boolean;
  aiReady: boolean;
  onPrepare: () => void;
}) {
  const [items, setItem] = useOptimistic(round?.prep ?? null, (current, { index, done }: { index: number; done: boolean }) =>
    current ? current.map((item, at) => (at === index ? { ...item, done, doneAt: done ? new Date().toISOString() : null } : item)) : current,
  );
  const [, startTicking] = useTransition();
  const tick = (index: number, done: boolean) =>
    startTicking(async () => {
      setItem({ index, done });
      const result = await tickPrep({ id: applicationId, interviewId: round!.id, index, done });
      if (!result.ok) toast(result.error);
    });

  return (
    <section aria-labelledby="getting-ready" aria-busy={preparing || undefined} className="flex flex-col gap-2">
      <h2 id="getting-ready" className="text-[12.5px] text-muted">
        Getting ready
      </h2>
      {items && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-2.5">
            {items.map((item, index) => (
              <li key={`${index}-${item.text}`}>
                <Checkbox
                  label={item.text}
                  hint={item.done && item.doneAt ? `Done ${formatShortDay(new Date(item.doneAt))}` : item.why || undefined}
                  checked={item.done}
                  onChange={(event) => tick(index, event.target.checked)}
                />
              </li>
            ))}
          </ul>
          <button type="button" className="self-start text-meta text-muted underline-offset-2 hover:text-ink hover:underline" aria-disabled={preparing || undefined} onClick={() => !preparing && onPrepare()}>
            {preparing ? "Writing it again…" : "Write it again"}
          </button>
        </>
      ) : (
        <>
          <p className="text-meta text-muted">A short checklist from the posting and this interview, written when you ask.</p>
          <Button variant="secondary" size="sm" className="self-start" aria-disabled={preparing || !aiReady || undefined} onClick={() => !preparing && onPrepare()}>
            {preparing ? "Getting you ready…" : "Prepare"}
          </Button>
        </>
      )}
    </section>
  );
}
