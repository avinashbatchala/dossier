"use client";

import { PanelLeftClose } from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState, type ReactNode } from "react";

import { GapForm, type GapAnswer } from "@/components/gap-form";
import { ScoreRing } from "@/components/score-ring";
import { addableSkill, matchScore, type Match, type MatchResult, type Requirement } from "@/lib/application-data";
import { cn } from "@/lib/cn";

/** A requirement's 20 px mark: ✓ filled when covered, – outlined when not (design 3b). */
const MARKS: Record<MatchResult, { mark: string; label: string; className: string }> = {
  covered: { mark: "✓", label: "Covered", className: "border-primary bg-primary text-on-primary" },
  partial: { mark: "~", label: "Partly covered", className: "border-warning-line bg-warning-surface text-warning" },
  gap: { mark: "–", label: "Not covered", className: "border-line-strong text-muted" },
};

function Mark({ result }: { result: MatchResult }) {
  return (
    <span aria-hidden="true" className={cn("grid size-5 flex-none place-items-center rounded-full border text-[11px] leading-none font-semibold", MARKS[result].className)}>
      {MARKS[result].mark}
    </span>
  );
}

export type { GapAnswer } from "@/components/gap-form";

/** What the requirement list can do with a gap (E30-5). */
export type GapActions = {
  /** Adds the skill; resolves to whether it went, so the form can close. */
  onAddSkill: (index: number, skill: string, answer: GapAnswer) => Promise<boolean>;
  /** "I don't have this". */
  onKnownGap: (requirement: string) => void;
  /** "Mention in the letter", when there's a letter to mention it in. */
  onMention?: (requirement: string) => void;
};

/**
 * Where the document on screen covers each requirement (E30-4): the ones it
 * serves can be selected, which highlights every covering line; `places`
 * says where, e.g. "Paragraph 2" on the letter.
 */
export type Coverage = {
  selected: string | null;
  onSelect: (requirement: string | null) => void;
  /** The requirements the document on screen has lines for. */
  served: ReadonlySet<string>;
  places?: Readonly<Record<string, string>>;
  /** Requirements the documents now use, whose place shows in green: "Used in the resume" while writing (E31-5). */
  used?: ReadonlySet<string>;
};

/**
 * "What they ask for" (E30-3): each requirement with its mark, and where
 * it's covered, or, for a gap, what can be done about it, in link blue.
 * "Add to profile" opens inside the row (E30-5, design 4g). A requirement
 * the document covers can be picked to highlight where (E30-4).
 */
function RequirementList({
  match,
  requirements,
  knownGaps = [],
  roles = [],
  onAddSkill,
  onKnownGap,
  onMention,
  coverage,
  numbered = false,
}: {
  match: Match;
  /** The extracted requirements, in the same order as the match's items. */
  requirements: Requirement[];
  /** The requirements the user doesn't have (E30-5). */
  knownGaps?: readonly string[];
  /** The roles in the application's profile, for "Where you used it". */
  roles?: readonly { id: string; label: string }[];
  coverage?: Coverage;
  /** Each row's number, as the posting's marks show it (E31-3). */
  numbered?: boolean;
} & GapActions) {
  const heading = useId();
  const [adding, setAdding] = useState<number | null>(null);
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-1">
      <h2 id={heading} className="pb-1.5 text-[12.5px] text-muted">
        What they ask for
      </h2>
      <ul aria-labelledby={heading} className="-mx-3 flex flex-col">
        {match.items.map((item, index) => {
          const known = item.result === "gap" && knownGaps.includes(item.requirement);
          const skill = item.result === "gap" && !known ? addableSkill(item, requirements[index]) : null;
          const open = adding === index && skill !== null;
          const pickable = coverage?.served.has(item.requirement) ?? false;
          const picked = pickable && coverage?.selected === item.requirement;
          const place = coverage?.places?.[item.requirement];
          const name = (
            <>
              <span className="sr-only">{MARKS[item.result].label}: </span>
              {item.requirement}
            </>
          );
          return (
            <li key={index} className={cn("rounded-card border px-3 py-2.5", open || picked ? "border-line-strong bg-selected" : "border-transparent")}>
              <div className="flex items-start gap-3">
                {numbered && <span className="w-3 flex-none pt-0.5 text-right text-[11px] text-muted tabular-nums">{index + 1}</span>}
                <Mark result={item.result} />
                <div className="flex min-w-0 flex-col gap-0.5">
                  {pickable ? (
                    <button
                      type="button"
                      aria-pressed={picked}
                      title={picked ? "Stop showing where it's covered" : "Show where it's covered"}
                      onClick={() => coverage!.onSelect(picked ? null : item.requirement)}
                      className="text-left text-sm font-medium text-ink hover:underline hover:underline-offset-2"
                    >
                      {name}
                    </button>
                  ) : (
                    <p className="text-sm font-medium text-ink">{name}</p>
                  )}
                  <p className={cn("text-meta", open ? "text-link" : coverage?.used?.has(item.requirement) ? "text-success" : "text-muted", !open && "line-clamp-2")}>
                    {item.result !== "gap" ? (
                      (place ?? item.note ?? MARKS[item.result].label)
                    ) : place && !open ? (
                      place
                    ) : known ? (
                      "You don't have this"
                    ) : open ? (
                      "Adding to your profile"
                    ) : (
                      <>
                        {skill ? "Not in your profile" : "Gap"}
                        {item.mustHave && " · must-have"}
                        {skill && (
                          <>
                            {" · "}
                            <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => setAdding(index)}>
                              Add to profile
                            </button>
                          </>
                        )}
                        {onMention && (
                          <>
                            {" · "}
                            <button type="button" className="text-link underline-offset-2 hover:underline" onClick={() => onMention(item.requirement)}>
                              Mention in the letter
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </div>
              {open && (
                <GapForm
                  skill={skill}
                  roles={roles}
                  onAdd={async (answer) => {
                    if (await onAddSkill(index, skill, answer)) setAdding(null);
                  }}
                  onKnown={() => {
                    setAdding(null);
                    onKnownGap(item.requirement);
                  }}
                  onCancel={() => setAdding(null)}
                  className="mt-3 ml-8"
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The Fit column (E30-3, design 3b): 380 px on wide windows; below about
 * 1500 px, a 68 px rail with the ring and a mark per requirement, which
 * opens the full column over the document. Esc or a click outside closes
 * it.
 */
export function FitColumn({
  match,
  open: openAsked,
  onOpenChange,
  children,
}: {
  match: Match | null;
  /** The overlay, when the page opens it, e.g. on Prepare (E30-6). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openAsked ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const { hit, total } = match ? matchScore(match) : { hit: 0, total: 0 };
  return (
    <>
      <aside aria-label="How you fit" className="hidden w-[380px] flex-none overflow-y-auto border-r border-line px-6 py-[22px] min-[1500px]:block">
        {children}
      </aside>
      <div className="relative flex w-[68px] flex-none border-r border-line min-[1500px]:hidden">
        <Dialog.Root modal={false} open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="flex w-full flex-col items-center gap-2.5 overflow-y-auto py-[22px] hover:bg-hover">
            <span className="sr-only">Show how you fit:</span> <ScoreRing hit={hit} total={total} size="lg" />
            <span aria-hidden="true" className="flex flex-col items-center gap-2 pt-1">
              {match?.items.map((item, index) => <Mark key={index} result={item.result} />)}
            </span>
          </Dialog.Trigger>
          <Dialog.Content
            aria-describedby={undefined}
            className="absolute inset-y-0 left-0 z-30 w-[380px] max-w-[calc(100vw-80px)] overflow-y-auto border-r border-line-card bg-surface px-6 py-[22px] shadow-menu focus:outline-none"
          >
            <Dialog.Title className="sr-only">How you fit</Dialog.Title>
            <Dialog.Close aria-label="Close" className="absolute top-3 right-3 grid size-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink">
              <PanelLeftClose size={16} aria-hidden="true" />
            </Dialog.Close>
            {children}
          </Dialog.Content>
        </Dialog.Root>
      </div>
    </>
  );
}

/** The column's content for Draft, Sent and Screening: the coverage, the posting's place and pay, and what they ask for. */
export function FitPanel({
  summary,
  meta,
  match,
  requirements,
  knownGaps,
  roles,
  coverage,
  numbered,
  ...actions
}: {
  summary: ReactNode;
  meta: string[];
  match: Match | null;
  requirements: Requirement[];
  knownGaps?: readonly string[];
  roles?: readonly { id: string; label: string }[];
  coverage?: Coverage;
  numbered?: boolean;
} & GapActions) {
  return (
    <div className="flex flex-col gap-[18px]">
      {summary}
      {meta.length > 0 && <p className="border-t border-line pt-4 text-meta leading-relaxed text-muted">{meta.join(" · ")}</p>}
      <div className="border-t border-line pt-4">
        {match && match.items.length > 0 ? (
          <RequirementList match={match} requirements={requirements} knownGaps={knownGaps} roles={roles} coverage={coverage} numbered={numbered} {...actions} />
        ) : (
          <p className="text-meta text-muted">No requirements from the posting yet.</p>
        )}
      </div>
    </div>
  );
}
