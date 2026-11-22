"use client";

import { Link2 } from "lucide-react";
import Link from "next/link";

import { Breadcrumb } from "@/components/breadcrumb";
import type { ReactNode } from "react";

import { ScoreRing } from "@/components/score-ring";
import { Button, buttonClassName } from "@/components/ui/button";

/** A saved posting or an agent find to start from (E31-2), as the page has it. */
export type StartFrom = {
  id: string;
  title: string;
  company: string;
  place: string;
  salary: string;
  hit: number;
  total: number;
  from: "saved" | "agent";
  /** "Saved · 2 days ago". */
  when: string;
};

/**
 * New application's first step (E31-2, design 6a): one box for the posting,
 * with its link, the profile it's written from and *Read the posting*; the
 * ways around it below; then the saved postings to start from instead.
 */
export function PasteStep({
  posting,
  onPosting,
  postingUrl,
  onPostingUrl,
  fetching,
  onFetch,
  profiles,
  profileId,
  onProfile,
  action,
  links,
  alreadySent,
  startFrom,
}: {
  posting: string;
  onPosting: (text: string) => void;
  postingUrl: string;
  onPostingUrl: (url: string) => void;
  fetching: boolean;
  onFetch: () => void;
  profiles: readonly { id: string; name: string }[];
  profileId: string | undefined;
  onProfile: (id: string) => void;
  /** *Read the posting*, or *Write it with Claude* without a model of Dossier's own. */
  action: ReactNode;
  /** The text links under the box. */
  links: ReactNode;
  /** The Already sent form, while it's open. */
  alreadySent: ReactNode;
  startFrom: readonly StartFrom[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-[clamp(24px,7vh,72px)] pb-20 sm:px-6">
      <Breadcrumb items={[{ label: "Applications", href: "/applications" }, { label: "New" }]} />
      <h1 className="mt-1.5 font-serif text-[clamp(30px,5vw,40px)] leading-[1.15] tracking-[-0.01em]">What are you applying for?</h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-muted">
        Paste the posting. I&apos;ll read it, check it against your profile and show you how you match before I write anything.
      </p>

      <div className="mt-6 flex flex-col rounded-[14px] border border-line-input bg-input">
        <textarea
          aria-label="Job posting"
          value={posting}
          onChange={(event) => onPosting(event.target.value)}
          placeholder="Paste the job posting here: the whole text, as it appears."
          className="min-h-[260px] resize-y rounded-t-[14px] bg-transparent px-5 py-4 text-[15px] leading-relaxed text-ink placeholder:text-muted focus-visible:-outline-offset-2"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
          <label className="flex min-w-[220px] flex-1 items-center gap-2 text-muted">
            <Link2 size={15} aria-hidden="true" className="flex-none" />
            <span className="sr-only">Link to the posting</span>
            <input
              type="url"
              inputMode="url"
              value={postingUrl}
              onChange={(event) => onPostingUrl(event.target.value)}
              placeholder="Or a link to it · optional"
              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink placeholder:text-muted"
            />
          </label>
          {postingUrl.trim() && (
            <Button variant="text" size="sm" title="Bring the posting's text in from its link" aria-disabled={fetching || undefined} onClick={() => !fetching && onFetch()}>
              {fetching ? "Fetching…" : "Fetch"}
            </Button>
          )}
          {profiles.length > 1 && (
            <span className="flex items-center gap-1.5 rounded-control border border-line-control bg-input px-2.5 py-1 text-[13px] text-muted">
              <label htmlFor="write-from">Write from</label>
              <select id="write-from" value={profileId} onChange={(event) => onProfile(event.target.value)} className="bg-transparent font-medium text-ink">
                {profiles.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </span>
          )}
          {action}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">{links}</div>
      {alreadySent && <div className="mt-4">{alreadySent}</div>}

      {startFrom.length > 0 && (
        <section aria-labelledby="start-from" className="mt-10 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="start-from" className="text-[13px] font-medium text-muted">
              Or start from one you saved
            </h2>
            <Link href="/jobs" className="text-[13px] text-muted hover:text-ink">
              Positions →
            </Link>
          </div>
          <ul className="flex flex-col gap-1.5">
            {startFrom.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 rounded-card border border-line-card bg-card px-3.5 py-2.5">
                <ScoreRing hit={entry.hit} total={entry.total} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-ink">{entry.title || "Untitled posting"}</span>
                  <span className="truncate text-meta text-muted">{[entry.company, entry.place, entry.salary].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="hidden flex-none text-meta text-muted sm:inline">{entry.when}</span>
                <Link href={`/new?posting=${entry.id}`} className={buttonClassName("secondary", "sm", "flex-none")}>
                  Start{" "}
                  <span className="sr-only">
                    {entry.title || "Untitled posting"}
                    {entry.company && ` at ${entry.company}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
