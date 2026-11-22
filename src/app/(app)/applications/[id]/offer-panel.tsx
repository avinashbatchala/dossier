"use client";

import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { daysUntilCalendarDate, formatDay } from "@/lib/dates";
import { FLAG_SOON_DAYS } from "@/lib/application-flag";
import type { MessageKind } from "@/lib/message-draft";
import { rangePosition } from "@/lib/salary-range";

import { saveOffer } from "./actions";

/** The offer as the page has it (E30-7); dates as YYYY-MM-DD. */
export type OfferView = {
  salary: string;
  decideBy: string | null;
  startDate: string | null;
  holidays: string;
  office: string;
  /** Read from their offer email. */
  fromEmail: boolean;
};

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * The Offer column (E30-7, design 4e): the salary in serif, where it falls
 * on the posted range, Starts, Holidays, Office and Decide by, editable,
 * and the three answers, each drafted on its click.
 */
export function OfferPanel({
  applicationId,
  offer,
  postedSalary,
  drafting,
  aiReady,
  onDraft,
  fitLine,
  onShowFit,
}: {
  applicationId: string;
  offer: OfferView | null;
  postedSalary: string;
  /** An answer is being drafted. */
  drafting: boolean;
  aiReady: boolean;
  onDraft: (kind: Exclude<MessageKind, "follow-up">) => void;
  fitLine: string;
  onShowFit: () => void;
}) {
  const [editing, setEditing] = useState(offer === null);
  const range = offer ? rangePosition(postedSalary, offer.salary) : null;
  const soon = offer?.decideBy ? daysUntilCalendarDate(day(offer.decideBy), new Date(), "UTC") <= FLAG_SOON_DAYS : false;
  const rows: [string, string, boolean?][] = offer
    ? [
        ["Starts", offer.startDate ? formatDay(day(offer.startDate), "UTC") : ""],
        ["Holidays", offer.holidays],
        ["Office", offer.office],
        ["Decide by", offer.decideBy ? formatDay(day(offer.decideBy), "UTC") : "", soon],
      ]
    : [];

  return (
    <div className="flex flex-col gap-[18px]">
      <section aria-labelledby="the-offer" className="flex flex-col gap-3 rounded-card border border-line-card bg-card px-4 py-4">
        <p id="the-offer" className="flex items-center gap-2 text-[12.5px] text-muted">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-status-offer" />
          The offer{offer?.fromEmail && " · read from their email"}
        </p>
        {editing ? (
          <OfferForm applicationId={applicationId} offer={offer} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="font-serif text-[36px] leading-none">{offer?.salary || "No salary yet"}</p>
            {range && (
              <div className="flex flex-col gap-1">
                <div className="relative h-1.5 rounded-full bg-track" role="img" aria-label={`Posted range ${postedSalary}; the offer is ${Math.round(range.at * 100)}% of the way up`}>
                  <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary" style={{ left: `${range.at * 100}%` }} />
                </div>
                <p className="flex justify-between text-meta text-muted">
                  <span>Posted {postedSalary}</span>
                </p>
              </div>
            )}
            <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
              {rows.map(([label, value, warn]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className={cn(warn && "text-warning")}>{value || <span className="text-muted">Not said</span>}</dd>
                </div>
              ))}
            </dl>
            <button type="button" className="self-start text-[12.5px] text-link underline-offset-2 hover:underline" onClick={() => setEditing(true)}>
              Edit the offer
            </button>
          </>
        )}
      </section>

      <div className="flex flex-col items-stretch gap-2" aria-busy={drafting || undefined}>
        <Button aria-disabled={drafting || !aiReady || undefined} onClick={() => !drafting && onDraft("accept")}>
          {drafting ? "Drafting…" : "Draft an acceptance"}
        </Button>
        <Button variant="secondary" aria-disabled={drafting || !aiReady || undefined} onClick={() => !drafting && onDraft("more")}>
          Ask for more
        </Button>
        <button
          type="button"
          aria-disabled={drafting || !aiReady || undefined}
          onClick={() => !drafting && onDraft("decline")}
          className="min-h-[34px] rounded-control px-3 text-sm font-medium text-danger hover:bg-hover hover:text-error-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        >
          Decline politely
        </button>
        <p className="text-meta text-muted">Each drafts an answer for you to read first. Nothing is sent without you.</p>
      </div>

      <p className="border-t border-line pt-4 text-[13.5px]">
        {fitLine}
        {" · "}
        <button type="button" className="text-link underline-offset-2 hover:underline" onClick={onShowFit}>
          Show
        </button>
      </p>
    </div>
  );
}

/** The offer's details, by hand. */
function OfferForm({ applicationId, offer, onDone }: { applicationId: string; offer: OfferView | null; onDone: () => void }) {
  const [salary, setSalary] = useState(offer?.salary ?? "");
  const [startDate, setStartDate] = useState(offer?.startDate ?? "");
  const [decideBy, setDecideBy] = useState(offer?.decideBy ?? "");
  const [holidays, setHolidays] = useState(offer?.holidays ?? "");
  const [office, setOffice] = useState(offer?.office ?? "");
  const [saving, startSaving] = useTransition();
  const save = () =>
    startSaving(async () => {
      const result = toastResult(await saveOffer({ id: applicationId, salary, startDate: startDate || null, decideBy: decideBy || null, holidays, office }));
      if (result.ok) onDone();
    });
  return (
    <div role="group" aria-label="The offer's details" className="flex flex-col gap-3">
      <Input label="Salary" value={salary} placeholder="e.g. €82,000 a year" onChange={(event) => setSalary(event.target.value)} />
      <Input label="Starts" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      <Input label="Holidays" value={holidays} placeholder="e.g. 27 days" onChange={(event) => setHolidays(event.target.value)} />
      <Input label="Office" value={office} placeholder="e.g. Hybrid, 3 days in Amsterdam" onChange={(event) => setOffice(event.target.value)} />
      <Input label="Decide by" type="date" value={decideBy} onChange={(event) => setDecideBy(event.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" aria-disabled={saving || undefined} onClick={() => !saving && save()}>
          Save
        </Button>
        {offer && (
          <Button variant="text" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
