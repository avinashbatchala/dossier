"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";

import { FitDetails } from "@/components/fit-details";
import { ScoreMenu } from "@/components/score-menu";
import { listingList, listingPreview, ListingRow, listingSplit, PreviewBody, PreviewCard, PreviewFacts, PreviewHeader, RowTag } from "@/components/listing";
import { ScoreRing } from "@/components/score-ring";
import { coverageOf } from "@/lib/posting-coverage";
import { linksAttribution, SourceAttribution } from "@/components/source-attribution";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useJob } from "@/hooks/use-job";
import { openPendingTab, sendPendingTab } from "@/lib/claude-tab";
import { cn } from "@/lib/cn";
import { isBoardLink } from "@/lib/dedupe";
import type { JobView } from "@/lib/jobs/runner";
import { postedAgo, postingKey, type FoundPosting, type LibraryFilters, type PostingState, type ProfileFit, type ShownPosting } from "@/lib/job-search/search";
import { portalNames, postingPage, sourceInfo } from "@/lib/job-search/sources";

import {
  dismissFoundPosting,
  loadFullText,
  loadLibraryPage,
  markPostingsSeen,
  moveBackPostings,
  removeAllArchived,
  removeArchivedPostings,
  restorePosting,
  savePostingForLater,
  splitSameJob,
  startScoringPosting,
  unsavePosting,
} from "./actions";
import { AgentDraft } from "./agent-draft";
import { useStartApplication } from "./use-start-application";

/** Narrow windows show the posting above the list. */
const NARROW = "(max-width: 1023px)";

export type PostingResultsProps = {
  today: string;
  /** Score opens a Claude chat, which scores through the connector: it's on, and Dossier has no AI model of its own (#221). */
  scoreInClaude?: boolean;
  /** The library's first page through its filters (E22-5). */
  postings: ShownPosting[];
  /** The filters, for the next pages and for which postings belong in the list. */
  filters: LibraryFilters;
  /** How many postings the filters show in all, and whether there are more to load. */
  total: number;
  more: boolean;
  /** What the list says when nothing fits. */
  empty: string;
  /** The profiles, for Score to ask which (E25-5); it asks nothing with one. */
  profiles?: { id: string; name: string }[];
};

/** What a score job gives: the posting's best score and all its scores (E25-5). */
type Scored = { score: ProfileFit | null; scores: ProfileFit[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "Found by the agent · Frontend Berlin" (E22-8), or "" when the agent didn't find it. */
const foundByAgent = ({ agentSearches }: PostingState) =>
  agentSearches.length === 0 ? "" : ["Found by the agent", agentSearches.filter(Boolean).join(", ")].filter(Boolean).join(" · ");

/** The posting's link, or the employer's own when it's on a job board and a portal that found the same job has that (E22-6). */
const bestLink = (posting: ShownPosting) =>
  posting.url && !isBoardLink(posting.url) ? posting.url : (posting.state.foundOn.find((entry) => entry.url && !isBoardLink(entry.url))?.url ?? posting.url);

/**
 * Postings in a list, and the selected one's whole text beside it, or above
 * it on narrow windows: the positions library through its filters (E22-5).
 * A posting that stops fitting (unsaved in Saved, brought back in
 * Dismissed, dismissed anywhere else) leaves the list; opening one makes it
 * no longer new. In the Archive (E22-7), postings can be selected, moved
 * back or removed.
 */
export function PostingResults(props: PostingResultsProps) {
  const { show } = props.filters;
  const archive = props.filters.tab === "archive";
  const [postings, setPostings] = useState(props.postings);
  const [more, setMore] = useState(props.more);
  // A refresh brings the library as it is now (a portal answered, Mark all as seen): take it, keeping
  // what's under way here, such as a score being worked out.
  const [given, setGiven] = useState(props.postings);
  if (props.postings !== given) {
    setGiven(props.postings);
    setPostings(props.postings);
    setMore(props.more);
  }
  const [loadingMore, setLoadingMore] = useState(false);
  const inView = ({ state }: ShownPosting) =>
    archive ? state.archived : show === "saved" ? state.saved : show === "dismissed" ? state.dismissed : !state.dismissed;
  const visible = postings.filter(inView);
  // Jump to opens a posting with ?focus=<its key> (E27-6).
  const focus = useSearchParams().get("focus");
  const focused = focus && visible.some((posting) => postingKey(posting) === focus) ? focus : null;
  const [selectedKey, setSelectedKey] = useState(focused ?? (visible[0] ? postingKey(visible[0]) : null));
  const [focusSeen, setFocusSeen] = useState(focus);
  if (focus !== focusSeen) {
    setFocusSeen(focus);
    if (focused) setSelectedKey(focused);
  }
  const selected = visible.find((posting) => postingKey(posting) === selectedKey) ?? visible[0] ?? null;
  const detail = useRef<HTMLElement>(null);
  const now = new Date(props.today);
  const { starting, start } = useStartApplication();
  const router = useRouter();
  // Postings selected in the Archive, by postingKey, and whether "Remove all" is asking.
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false);
  // Postings being scored (#208), with the step under way, by postingKey.
  const [scoring, setScoring] = useState<Record<string, { jobId: string; step: string | null }>>({});

  const updateState = (key: string, change: Partial<PostingState>) =>
    setPostings((list) => list.map((posting) => (postingKey(posting) === key ? { ...posting, state: { ...posting.state, ...change } } : posting)));

  /** Opening a posting: shown beside the list, and no longer new. */
  const select = (key: string, { reveal = false } = {}) => {
    setSelectedKey(key);
    if (reveal && window.matchMedia?.(NARROW).matches) detail.current?.scrollIntoView({ block: "start" });
    const posting = postings.find((entry) => postingKey(entry) === key);
    if (posting?.state.new && posting.state.postingId) {
      updateState(key, { new: false });
      void markPostingsSeen({ postingIds: [posting.state.postingId] });
    }
  };

  /** Changes a posting's state; when that takes it out of the list, the next one takes its place. */
  const change = (posting: ShownPosting, state: Partial<PostingState>) => {
    const key = postingKey(posting);
    const index = visible.findIndex((entry) => postingKey(entry) === key);
    const after = visible[index + 1] ?? visible[index - 1];
    updateState(key, state);
    if (!inView({ ...posting, state: { ...posting.state, ...state } }) && after) setSelectedKey(postingKey(after));
  };

  const save = async (posting: ShownPosting) => {
    const result = toastResult(await savePostingForLater({ posting: withoutState(posting) }));
    if (!result.ok) return;
    change(posting, { saved: true, dismissed: false, new: false, archived: false, postingId: result.data.postingId });
    setSelectedKey(postingKey(posting));
  };

  const unsave = async (posting: ShownPosting) => {
    const result = await unsavePosting({ source: posting.source, externalId: posting.externalId });
    if (!result.ok) return void toast(result.error);
    change(posting, { saved: false });
    // In Saved, the posting leaves the list: Undo puts it back.
    if (show === "saved") toast("Removed from Saved.", { action: { label: "Undo", onClick: () => void save(posting) } });
    else toastResult(result);
  };

  const restore = async (posting: ShownPosting, saved: boolean) => {
    const result = toastResult(await restorePosting({ source: posting.source, externalId: posting.externalId, saved }));
    if (!result.ok) return;
    change(posting, { dismissed: false, saved });
    if (show === "dismissed") toast("Brought back. It's in Positions again.");
  };

  const dismiss = async (posting: ShownPosting) => {
    const result = await dismissFoundPosting({ posting: withoutState(posting) });
    if (!result.ok) return void toast(result.error);
    change(posting, { dismissed: true, saved: false, new: false, archived: false });
    toast("Dismissed. It won't come back, from any search.", {
      action: {
        label: "Undo",
        onClick: () => {
          void restore(posting, result.data.wasSaved);
          setSelectedKey(postingKey(posting));
        },
      },
    });
  };

  const score = async (posting: ShownPosting, profiles?: string) => {
    const key = postingKey(posting);
    if (scoring[key]) return;
    setScoring((current) => ({ ...current, [key]: { jobId: "", step: null } }));
    // Opened now, while the click still counts: a tab opened after waiting is blocked as a pop-up (#221).
    const chat = props.scoreInClaude ? openPendingTab() : null;
    const result = toastResult(await startScoringPosting({ posting: withoutState(posting), profiles }));
    if (result.ok && "setLevels" in result.data) {
      // The profile's levels aren't chosen yet (E24-3): where to choose them.
      const { message, href } = result.data.setLevels;
      chat?.close();
      setScoring((current) => without(current, key));
      toast(message, { action: { label: "Choose levels", onClick: () => window.location.assign(href) } });
      return;
    }
    if (result.ok && "handoff" in result.data) {
      sendPendingTab(chat, result.data.handoff);
      setScoring((current) => without(current, key));
      toast("Scoring it in Claude. Reload this page once Claude has saved the score.");
      return;
    }
    chat?.close();
    setScoring((current) => (result.ok && "jobId" in result.data ? { ...current, [key]: { jobId: result.data.jobId, step: null } } : without(current, key)));
  };

  const scoringChanged = (key: string, job: JobView<Scored>) => {
    if (job.status === "DONE" || job.status === "FAILED") {
      setScoring((current) => without(current, key));
      if (job.status === "DONE" && job.result) updateState(key, job.result);
      else toast(job.error ?? "The posting couldn't be scored. Try again.");
      return;
    }
    setScoring((current) => (current[key] ? { ...current, [key]: { ...current[key], step: job.step } } : current));
  };

  /** Out of the Archive (Move back, Remove): out of this list, and the counts change. */
  const leaveArchive = (gone: readonly ShownPosting[]) => {
    const keys = new Set(gone.map(postingKey));
    const next = visible.find((posting) => !keys.has(postingKey(posting)));
    setPostings((list) => list.map((posting) => (keys.has(postingKey(posting)) ? { ...posting, state: { ...posting.state, archived: false } } : posting)));
    setChosen((current) => new Set([...current].filter((key) => !keys.has(key))));
    if (selected && keys.has(postingKey(selected)) && next) setSelectedKey(postingKey(next));
    router.refresh();
  };

  const rowsOf = (list: readonly ShownPosting[]) => list.flatMap((posting) => (posting.state.postingId ? [posting.state.postingId] : []));

  const moveBackFromArchive = async (list: readonly ShownPosting[]) => {
    if (toastResult(await moveBackPostings({ postingIds: rowsOf(list) })).ok) leaveArchive(list);
  };

  const removeFromArchive = async (list: readonly ShownPosting[]) => {
    if (toastResult(await removeArchivedPostings({ postingIds: rowsOf(list) })).ok) leaveArchive(list);
  };

  const removeAll = async () => {
    if (toastResult(await removeAllArchived({ filters: props.filters })).ok) {
      setChosen(new Set());
      router.refresh();
    }
  };

  const chosenPostings = visible.filter((posting) => chosen.has(postingKey(posting)));
  const toggle = (key: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** "Not the same job" (E22-6): the postings merged into this one show on their own again. */
  const split = async (posting: ShownPosting) => {
    if (!posting.state.postingId) return;
    const result = toastResult(await splitSameJob({ postingId: posting.state.postingId }));
    if (result.ok) router.refresh();
  };

  /** The library's next page, through the same filters. */
  const showMore = async () => {
    if (!more || loadingMore) return;
    setLoadingMore(true);
    const result = await loadLibraryPage({ filters: props.filters, offset: postings.length });
    setLoadingMore(false);
    if (!result.ok) return void toast(result.error);
    const seen = new Set(postings.map(postingKey));
    setPostings([...postings, ...result.data.postings.filter((posting) => !seen.has(postingKey(posting)))]);
    setMore(result.data.more);
  };

  const counted = archive
    ? `${plural(props.total, "posting", "postings")} in the Archive${more ? `, showing ${postings.length}` : ""}`
    : show === "saved"
      ? plural(visible.length, "saved posting", "saved postings")
      : show === "dismissed"
        ? `${plural(visible.length, "dismissed posting", "dismissed postings")}, kept out of every search`
        : `${plural(props.total, "posting", "postings")}${more ? `, showing ${postings.length}` : ""}`;

  return (
    <div className={listingSplit}>
      {Object.entries(scoring).map(([key, { jobId }]) =>
        jobId ? <ScoreWatcher key={jobId} jobId={jobId} onChange={(job) => scoringChanged(key, job)} /> : null,
      )}
      {/* The 600 px list (E32-1), beside the preview on wide windows. */}
      <div className={listingList}>
        <p className={cn("px-5 pt-3 pb-1 text-meta text-muted", visible.length === 0 && "hidden")}>{counted}</p>
        {archive && visible.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-2">
            <Checkbox
              label={chosenPostings.length > 0 ? `${chosenPostings.length} selected` : "Select all"}
              checked={chosenPostings.length > 0 && chosenPostings.length === visible.length}
              ref={(input) => {
                if (input) input.indeterminate = chosenPostings.length > 0 && chosenPostings.length < visible.length;
              }}
              onChange={() => setChosen(chosenPostings.length === visible.length ? new Set() : new Set(visible.map(postingKey)))}
              className="mr-2"
            />
            {chosenPostings.length > 0 && (
              <>
                <Button variant="secondary" size="sm" onClick={() => void moveBackFromArchive(chosenPostings)}>
                  Move back
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void removeFromArchive(chosenPostings)}>
                  Remove
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setConfirmingRemoveAll(true)}>
              Remove all
            </Button>
            <ConfirmDialog
              open={confirmingRemoveAll}
              onOpenChange={setConfirmingRemoveAll}
              title={props.total === 1 ? "Remove the posting in the Archive?" : `Remove all ${props.total} postings in the Archive?`}
              description="They leave Dossier for good, and no search brings them back. Saved postings and applications aren't touched."
              confirmLabel="Remove all"
              onConfirm={() => void removeAll()}
            />
          </div>
        )}

        {visible.length === 0 ? (
          <div className="mx-5 my-4 rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">{props.empty}</div>
        ) : (
          <PostingList
            postings={visible}
            chosen={archive ? chosen : null}
            onChoose={toggle}
            selectedKey={selected ? postingKey(selected) : null}
            now={now}
            onSelect={select}
            scoring={scoring}
          />
        )}

        {more && (
          <Button variant="secondary" className="mx-5 my-3 self-start" onClick={() => void showMore()} aria-disabled={loadingMore || undefined}>
            {loadingMore ? "Loading more…" : "Show more"}
          </Button>
        )}
      </div>

      {selected && (
        <PostingDetail
          key={postingKey(selected)}
          ref={detail}
          posting={selected}
          now={now}
          onSave={() => void save(selected)}
          onUnsave={() => void unsave(selected)}
          onDismiss={() => void dismiss(selected)}
          onRestore={() => void restore(selected, false)}
          scoring={scoring[postingKey(selected)] ?? null}
          onScore={(profiles) => void score(selected, profiles)}
          profiles={props.profiles ?? []}
          onSplit={() => void split(selected)}
          onMoveBack={() => void moveBackFromArchive([selected])}
          onRemove={() => void removeFromArchive([selected])}
        >
          {!selected.state.dismissed && (
            <StartButton starting={starting === postingKey(selected)} onClick={() => void start(withoutState(selected), postingKey(selected))} />
          )}
          {!selected.state.dismissed && selected.state.agent && <AgentDraft agent={selected.state.agent} />}
        </PostingDetail>
      )}
    </div>
  );
}

/** A copy of `record` without `key`. */
function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

/** Follows a posting's scoring job (#208). */
function ScoreWatcher({ jobId, onChange }: { jobId: string; onChange: (job: JobView<Scored>) => void }) {
  useJob<Scored>(jobId, 0, onChange);
  return null;
}

/** "Start application →" on a posting (E14-8). */
function StartButton({ starting, onClick }: { starting: boolean; onClick: () => void }) {
  return (
    <Button size="sm" aria-disabled={starting || undefined} onClick={starting ? undefined : onClick}>
      {starting ? "Starting…" : "Start application →"}
    </Button>
  );
}

/** The posting as the server takes it back: without where it stands. */
function withoutState(posting: ShownPosting): FoundPosting {
  const { state, ...found } = posting;
  void state;
  return found;
}

function PostingList({
  postings,
  chosen,
  onChoose,
  selectedKey,
  now,
  onSelect,
  scoring,
}: {
  postings: ShownPosting[];
  /** In the Archive: the postings selected, by postingKey; null elsewhere. */
  chosen: ReadonlySet<string> | null;
  onChoose: (key: string) => void;
  selectedKey: string | null;
  now: Date;
  onSelect: (key: string, options?: { reveal?: boolean }) => void;
  /** Postings being scored, by postingKey. */
  scoring: Record<string, unknown>;
}) {
  // Up and down move through the list, as in a mail inbox.
  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-posting]")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const target = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!target) return;
    event.preventDefault();
    target.focus();
    onSelect(target.dataset.posting!);
  };

  return (
    <ul aria-label="Postings" className="flex flex-col border-t border-line" onKeyDown={move}>
      {postings.map((posting) => {
        const key = postingKey(posting);
        const title = posting.title || "Untitled posting";
        const fit = posting.state.score;
        return (
          <li key={key} className="relative flex items-start">
            {chosen && (
              <input
                type="checkbox"
                aria-label={`Select “${title}”`}
                checked={chosen.has(key)}
                onChange={() => onChoose(key)}
                className="mt-5 ml-5 size-4 shrink-0 accent-primary"
              />
            )}
            <ListingRow
              data-posting={key}
              selected={key === selectedKey}
              dimmed={posting.state.dismissed}
              onClick={() => onSelect(key, { reveal: true })}
              // The coverage ring (E32-2); an empty one until it's scored.
              lead={
                fit ? (
                  <ScoreRing {...coverageOf(fit)} />
                ) : (
                  <span aria-hidden="true" className={cn("block h-7 w-11 rounded-full border border-dashed border-line-strong", Boolean(scoring[key]) && "motion-safe:animate-pulse")} />
                )
              }
              title={title}
              tag={<StateBadges state={posting.state} now={now} />}
              sub={[posting.company, posting.place, posting.remote ? "Remote" : ""].filter(Boolean).join(" · ")}
              meta={[
                postedAgo(posting.postedAt, now),
                // Where it was listed: every portal that found it, else the board its portal found it on.
                posting.state.foundOn.length > 1 ? portalNames(posting.state.foundOn.map((entry) => entry.portal)) : posting.via || portalNames([posting.source]),
                posting.salary,
                foundByAgent(posting.state),
                fit ? (fit.profileName ? `fits ${fit.profileName} best` : "") : scoring[key] ? "scoring…" : "not scored yet",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            {/* Adzuna's label is a link, so it lies over the row's corner (E14-2). */}
            {linksAttribution(posting.source) && (
              <span className="pointer-events-none absolute right-5 bottom-3">
                <SourceAttribution source={posting.source} url={posting.url} className="pointer-events-auto" />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StateBadges({ state, now }: { state: PostingState; now: Date }) {
  const badges = [
    // In the Archive, nothing is new; one a search found again there is "Still listed" (E22-7).
    state.archived ? state.stillListedAt && `Still listed · ${postedAgo(state.stillListedAt, now)}` : state.new && "New",
    state.applicationId && "Applied",
    state.saved && "Saved",
    state.dismissed && "Dismissed",
  ].filter(Boolean) as string[];
  if (badges.length === 0) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {badges.map((badge) => (
        <RowTag key={badge}>{badge}</RowTag>
      ))}
    </span>
  );
}

type Text = { status: "ready"; text: string } | { status: "loading" } | { status: "partial"; text: string };

/** The selected posting: its facts, what to do with it, and its whole text. */
function PostingDetail({
  ref,
  posting,
  now,
  onSave,
  onUnsave,
  onDismiss,
  onRestore,
  scoring,
  onScore,
  profiles,
  onSplit,
  onMoveBack,
  onRemove,
  children,
}: {
  ref: Ref<HTMLElement>;
  posting: ShownPosting;
  now: Date;
  onSave: () => void;
  onUnsave: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  /** While it's being scored (#208): the step under way. */
  scoring: { step: string | null } | null;
  onScore: (profiles?: string) => void;
  profiles: { id: string; name: string }[];
  /** "Not the same job", for one found on more than one portal (E22-6). */
  onSplit: () => void;
  /** In the Archive (E22-7): Move back and Remove, in place of Save and Dismiss. */
  onMoveBack: () => void;
  onRemove: () => void;
  /** More actions, before Save (E14-8). */
  children?: ReactNode;
}) {
  const headingId = useId();
  const sourcePage = postingPage(posting);
  // The posting as first shown; the component is keyed by it.
  const [initial] = useState(posting);
  const [text, setText] = useState<Text>(initial.complete ? { status: "ready", text: initial.description } : { status: "loading" });

  // A source that only sent the start: ask for the rest (E14-2, E14-3).
  useEffect(() => {
    if (initial.complete) return;
    let current = true;
    void loadFullText({ posting: withoutState(initial) }).then((result) => {
      if (!current) return;
      const full = result.ok ? result.data.text : null;
      setText(full ? { status: "ready", text: full } : { status: "partial", text: initial.description });
    });
    return () => {
      current = false;
    };
  }, [initial]);

  const { state } = posting;
  const ago = postedAgo(posting.postedAt, now);
  const link = bestLink(posting);
  const portals = portalNames(state.foundOn.length > 0 ? state.foundOn.map((entry) => entry.portal) : [posting.source]);
  const when = ago === "Today" || ago === "Yesterday" ? ago.toLowerCase() : ago;
  const kicker = [
    state.archived ? "In the Archive" : state.dismissed ? "Dismissed" : state.applicationId ? "Applied for" : state.saved ? "Saved" : state.new ? "New" : "",
    when ? `posted ${when}` : "",
    portals ? `on ${portals}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // Only what the portal gave (U2): nothing is read into the posting for these.
  const facts = [
    { label: "Posted", value: ago },
    { label: "Where", value: [posting.place, posting.remote ? "Remote" : posting.remote === false ? "On-site or hybrid" : ""].filter(Boolean).join(" · ") },
    { label: "Salary", value: posting.salary },
    { label: "Via", value: posting.via },
    { label: "Also on", value: state.foundOn.length > 1 ? portalNames(state.foundOn.slice(1).map((entry) => entry.portal)) : "" },
  ].filter((fact) => fact.value);
  const scoreButton = (
    <ScoreMenu profiles={profiles} disabled={Boolean(scoring)} onScore={onScore}>
      <Button variant="secondary" size="sm" aria-disabled={scoring ? true : undefined} onClick={scoring || profiles.length > 1 ? undefined : () => onScore()}>
        {scoring ? "Scoring…" : state.score ? "Score again" : "Score"}
      </Button>
    </ScoreMenu>
  );

  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      className={cn(listingPreview, "scroll-mt-[121px] max-lg:max-h-[75vh] max-lg:overflow-y-auto")}
    >
      <PreviewHeader
        id={headingId}
        kicker={kicker}
        title={posting.title || "Untitled posting"}
        sub={[posting.company, posting.place, posting.remote ? "Remote" : "", posting.salary].filter(Boolean).join(" · ")}
        actions={
          <>
            {children}
            {state.archived ? (
              <Button variant="secondary" size="sm" onClick={onMoveBack}>
                Move back
              </Button>
            ) : state.dismissed ? (
              <Button variant="secondary" size="sm" onClick={onRestore}>
                Bring back
              </Button>
            ) : (
              <Button variant="secondary" size="sm" aria-pressed={state.saved} onClick={state.saved ? onUnsave : onSave}>
                {state.saved ? (
                  <>
                    Saved <span aria-hidden="true">✓</span>
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            )}
            {link && (
              <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
                Open posting<span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {/* A BA posting with a link of its own still links to its ad on arbeitsagentur.de (#223). */}
            {sourcePage && sourcePage !== link && (
              <a href={sourcePage} target="_blank" rel="noopener noreferrer" className={buttonClassName("secondary", "sm")}>
                On arbeitsagentur.de<span aria-hidden>↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
            {state.score && scoreButton}
          </>
        }
        quiet={
          state.archived ? (
            <Button variant="text" size="sm" onClick={onRemove}>
              Remove
            </Button>
          ) : (
            !state.dismissed && (
              <Button variant="text" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            )
          )
        }
      />

      {state.applicationId && (
        <p role="note" className="rounded-card bg-track px-4 py-3 text-meta">
          You&apos;ve applied for this.{" "}
          <Link href={`/applications/${state.applicationId}`} className="underline underline-offset-2">
            Open the application
          </Link>
        </p>
      )}
      {state.foundOn.length > 1 && (
        <p className="text-meta text-muted">
          Found on{" "}
          {state.foundOn.map((entry, index) => (
            <span key={entry.portal}>
              {index > 0 && (index === state.foundOn.length - 1 ? " and " : ", ")}
              {entry.url ? (
                <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                  {sourceInfo(entry.portal).name}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                sourceInfo(entry.portal).name
              )}
            </span>
          ))}
          , as the same job.{" "}
          <button type="button" onClick={onSplit} className="underline underline-offset-2 hover:text-ink">
            Not the same job
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PreviewCard label="How it fits">
          {scoring && state.scores.length > 0 ? (
            <p role="status" className="text-meta text-muted">
              {scoring.step ?? "Starting…"}
            </p>
          ) : state.scores.length > 0 ? (
            // Every profile's (E25-5), each under its name when there are several.
            state.scores.map((fit) => (
              <section key={fit.profileId} aria-label={fit.profileName ? `Score for “${fit.profileName}”` : undefined}>
                <FitDetails fit={fit} older={fit.older} note={fit.profileName ? `For ${fit.profileName}` : undefined} />
              </section>
            ))
          ) : (
            <div className="flex flex-col items-start gap-3">
              {scoring ? (
                <p role="status" className="text-meta text-muted">
                  {scoring.step ?? "Starting…"}
                </p>
              ) : (
                <p className="text-sm text-muted">Not scored yet. Scoring checks each requirement against your profile.</p>
              )}
              {scoreButton}
            </div>
          )}
        </PreviewCard>
        {facts.length > 0 && (
          <PreviewCard label="Facts">
            <PreviewFacts facts={facts} />
          </PreviewCard>
        )}
      </div>

      <div role="region" aria-label="Posting text" className="border-t border-line pt-5">
        {text.status === "loading" ? (
          <p role="status" className="text-sm text-muted">
            Getting the whole posting…
          </p>
        ) : (
          <>
            {text.status === "partial" && (
              <p className="mb-3 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
                This is only the start of the posting. When you start an application, you can paste the rest from the posting&apos;s page.
              </p>
            )}
            <PreviewBody>{text.text || "The source didn't send a description."}</PreviewBody>
          </>
        )}
      </div>
      {/* As each portal's terms ask (E14-2, E14-3), for each that found it (E22-6). */}
      {[{ portal: posting.source, url: posting.url }, ...state.foundOn.filter((entry) => entry.portal !== posting.source)].map((entry) => (
        <SourceAttribution key={entry.portal} source={entry.portal} url={entry.url || posting.url} className="self-start" />
      ))}
    </section>
  );
}
