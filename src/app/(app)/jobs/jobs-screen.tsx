"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";

import { Search, SlidersHorizontal } from "lucide-react";

import { ArbeitsagenturNote } from "@/components/arbeitsagentur-note";
import { FilterChip, FilterChips, listingScreen, type ListingTab, ListingTabs, SourceBar } from "@/components/listing";
import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Country } from "@/lib/job-search/countries";
import {
  describeSearch,
  FOUND_BY_AGENT,
  LIBRARY_SHOWS,
  libraryHref,
  portalsLine,
  POSTED_WITHIN,
  searchChips,
  searchHref,
  type JobSource,
  type LibraryFilters,
  type LibraryShow,
  type PastSearchDay,
  type SearchPortal,
  type SearchProblem as Problem,
  type SearchQuery,
  type ShownPosting,
  type StoredSearch,
} from "@/lib/job-search/search";
import { knownPortals, sourceInfo } from "@/lib/job-search/sources";
import { useJob } from "@/hooks/use-job";
import { COVERS, COVERS_LABELS } from "@/lib/posting-coverage";

import { acceptArbeitsagenturNote, markAllPostingsSeen, removeJobSearch, retryPortalSearch, runJobSearch, showMorePostings } from "./actions";
import { PostingResults } from "./posting-results";
import { countryCoverage, RemoteOnlyField, SearchFields } from "./search-fields";

export type JobsScreenProps = {
  /** The first portal switched on in Settings; null while none is (E22-3). */
  /** The portals switched on, in order: a search asks all of them. */
  sources: readonly JobSource[];
  /** The Bundesagentur für Arbeit is on, but its note isn't accepted yet: it isn't searched until then (#223). */
  arbeitsagenturNote?: boolean;
  /** Score opens a Claude chat, which scores through the connector (#221). */
  scoreInClaude?: boolean;
  /** Every country by name, named on the server. */
  countries: readonly Country[];
  /** What the form starts from: the search in the URL, else the last one, else the profile's. */
  query: SearchQuery;
  /** The library's filters (E22-5). */
  filters: LibraryFilters;
  /** The library through them: the first page, how many in all, and whether there are more. */
  library: { postings: ShownPosting[]; total: number; more: boolean };
  /** Every kept search, for "Found by". */
  searches: PastSearchDay[];
  /** The search "Found by" names, with what to ask for next; null for none. */
  foundSearch: StoredSearch | null;
  /** The URL names a search that's no longer kept. */
  missingSearch?: boolean;
  /** How many postings each kind of "Show" holds, and the Archive. */
  counts: { open: number; new: number; saved: number; applied: number; dismissed: number; archived: number };
  /** Days before an untouched posting moves to the Archive (E22-7). */
  archiveDays?: number;
  /** Now, from the server, so "3 days ago" reads the same on both sides. */
  today: string;
  /** The profiles, for Score and the Fits filter (E25-5). */
  profiles?: { id: string; name: string }[];
  /** The URL asks for a search: the form opens with it (E32-3). */
  editing?: boolean;
};

const SETTINGS_HREF = "/settings?section=jobs";

/**
 * Positions (E14-6, E22-5): the search form, and the one list of every
 * posting the searches found, once, through its filters. A search lands on
 * the list filtered to what it found.
 */
export function JobsScreen({
  sources,
  arbeitsagenturNote = false,
  scoreInClaude = false,
  countries,
  query,
  filters,
  library,
  searches,
  foundSearch,
  missingSearch = false,
  counts,
  archiveDays = 30,
  today,
  profiles = [],
  editing: editingAsked = false,
}: JobsScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Edit opens the whole form in place (E32-1); it starts open until the first search.
  const [editing, setEditing] = useState(editingAsked || (searches.length === 0 && !foundSearch));
  // A search that didn't work, with what was asked, for Try again.
  const [failed, setFailed] = useState<{ problem: Problem; query: SearchQuery } | null>(null);

  // Each search is kept and gets its own history entry, so Back returns to it without asking the portal again.
  const run = (next: SearchQuery) =>
    startTransition(async () => {
      const result = await runJobSearch({ query: next });
      if (!result.ok) return void toast(result.error);
      if (!result.data.ok) return void setFailed({ problem: result.data, query: next });
      setFailed(null);
      setEditing(false);
      router.push(libraryHref({ found: result.data.id }), { scroll: false });
    });

  const acceptArbeitsagentur = async () => {
    const result = toastResult(await acceptArbeitsagenturNote({}));
    if (result.ok) {
      setFailed(null);
      router.refresh();
    }
    return result.ok;
  };

  const searched = foundSearch?.query;
  const radius = foundSearch ? sourceInfo(foundSearch.source).radius && foundSearch.query.radiusKm !== null : false;
  const empty = missingSearch
    ? "That search is no longer kept. Search again, or choose another under Found by."
    : filters.tab === "archive"
      ? counts.archived === 0
        ? `Nothing in the Archive. A posting you don't save, apply for or dismiss moves here ${archiveDays} days after a search last found it.`
        : "No postings in the Archive fit these filters."
    : searched && foundSearch.postings.length === 0
      ? radius
        ? `No postings for “${searched.keywords}”${searched.place ? ` within ${searched.radiusKm} km of ${searched.place}` : ""}. Try a bigger radius or fewer words.`
        : `No postings for “${searched.keywords}”${searched.place ? ` in ${searched.place}` : ""}. Try fewer words.`
    : filters.found === FOUND_BY_AGENT && filters.show === "open"
      ? "Nothing from the job agent here yet. What its runs find lands here, best first."
    : filters.show === "saved"
      ? "Nothing saved yet. Save a posting to keep it here."
      : filters.show === "dismissed"
        ? "Nothing dismissed. Postings you dismiss never come back, from any search, and wait here."
        : filters.show === "new"
          ? "Nothing new. Every posting here has been opened."
          : counts.open === 0
            ? "Search for a role, a skill or a company. Every posting a search finds lands here, once, so you can come back to it without spending another search."
            : "No postings fit these filters.";

  const asked = foundSearch?.query ?? query;
  const countryName = countries.find((country) => country.code === asked.country)?.name ?? asked.country.toUpperCase();
  const portals = foundSearch?.portals.filter((portal) => portal.status !== "skipped").length ?? 0;

  return (
    <div className={listingScreen}>
      <PageHeader
        title="Positions"
        description={`Postings from every portal you switched on, each listed once${profiles.length === 1 ? `, scored against ${profiles[0].name}` : ""}.`}
        actions={
          <Link href={SETTINGS_HREF} className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink">
            <SlidersHorizontal size={14} aria-hidden="true" />
            Portals and scoring
          </Link>
        }
      />
      {arbeitsagenturNote && <ArbeitsagenturNote accepted={false} onAccept={acceptArbeitsagentur} className="mx-10 mb-5 max-w-[760px]" />}
      <div className="flex flex-col gap-3 px-10 pb-4">
        {sources.length > 0 ? (
          <SourceBar
            label="Search"
            icon={<Search size={16} />}
            chips={searchChips(asked, countryName, foundSearch?.source ?? sources[0])}
            note={foundSearch ? `Searched ${foundSearch.ranAt}${portals > 1 ? ` · ${portals} portals` : ""} · ${foundSearch.postings.length} found` : searches.length > 0 ? null : "Not searched yet"}
            actions={
              <>
                <Button variant="secondary" size="sm" aria-expanded={editing} onClick={() => setEditing(!editing)}>
                  {editing ? "Close" : "Edit search"}
                </Button>
                {!editing && (
                  <Button size="sm" aria-disabled={pending || !asked.keywords.trim() || undefined} onClick={() => !pending && asked.keywords.trim() && run(asked)}>
                    {pending ? "Searching…" : foundSearch ? "Search again" : "Search"}
                  </Button>
                )}
              </>
            }
            editor={editing && <SearchForm sources={sources} countries={countries} query={query} pending={pending} onSearch={run} />}
          />
        ) : (
          <NoSource />
        )}
        {/* Announces each search's outcome; the list itself is replaced. */}
        <p role="status" className="sr-only">
          {pending ? "Searching…" : failed ? failed.problem.message : foundSearch ? `${foundSearch.postings.length} postings found.` : ""}
        </p>
        {failed && <SearchProblem problem={failed.problem.problem} message={failed.problem.message} onRetry={() => run(failed.query)} />}
        {foundSearch && <FoundSearch search={foundSearch} />}
      </div>
      <LibraryBar filters={filters} searches={searches} counts={counts} countries={countries} archiveDays={archiveDays} profiles={profiles} />
      <div className={cn("flex flex-1 flex-col motion-safe:transition-opacity lg:min-h-[360px]", pending && "opacity-60")} aria-busy={pending || undefined}>
        <PostingResults
          // New filters start the list over; a refresh (a portal answering, More, Mark all as seen) only updates it.
          key={libraryHref(filters)}
          postings={library.postings}
          total={library.total}
          more={library.more}
          filters={filters}
          empty={empty}
          today={today}
          scoreInClaude={scoreInClaude}
          profiles={profiles}
        />
      </div>
    </div>
  );
}

function SearchForm({
  sources,
  countries,
  query,
  pending,
  onSearch,
}: {
  sources: readonly JobSource[];
  countries: readonly Country[];
  query: SearchQuery;
  pending: boolean;
  onSearch: (query: SearchQuery) => void;
}) {
  const [form, setForm] = useState(query);
  const [errors, setErrors] = useState<{ keywords?: string; country?: string }>({});
  // Back and forward change the URL's search; the form follows.
  const [shown, setShown] = useState(query);
  if (searchHref(query) !== searchHref(shown)) {
    setShown(query);
    setForm(query);
    setErrors({});
  }

  const set = (patch: Partial<SearchQuery>) => setForm((current) => ({ ...current, ...patch }));
  const uncovered = countryCoverage(sources, form, countries).error;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const problems = {
      keywords: form.keywords.trim() ? undefined : "Type what you're looking for.",
      country: form.country ? uncovered : "Choose a country.",
    };
    setErrors(problems);
    if (problems.keywords || problems.country) return;
    onSearch({ ...form, keywords: form.keywords.trim(), place: form.place.trim() });
  };

  return (
    <form
      role="search"
      aria-label="Search postings"
      noValidate
      onSubmit={submit}
      className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1.3fr_1fr_1fr_1fr]"
    >
      <SearchFields value={form} onChange={set} sources={sources} countries={countries} errors={errors} />
      <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2 lg:col-span-6">
        <RemoteOnlyField value={form} onChange={set} sources={sources} />
        <Button type="submit" aria-disabled={pending || undefined}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Where postings stand and what narrows them (E22-5, E32-3): underlined tabs
 * with counts (All open · New · Saved · Applied for · Dismissed · Archive),
 * then the filters as chips and the sort. Each change is a new URL, so Back
 * undoes it.
 */
function LibraryBar({
  filters,
  searches,
  counts,
  countries,
  archiveDays,
  profiles,
}: {
  filters: LibraryFilters;
  searches: PastSearchDay[];
  counts: JobsScreenProps["counts"];
  countries: readonly Country[];
  archiveDays: number;
  profiles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const go = (change: Partial<LibraryFilters>) => router.push(libraryHref({ ...filters, ...change }), { scroll: false });
  const countOf: Record<LibraryShow, number> = { open: counts.open, new: counts.new, saved: counts.saved, applied: counts.applied, dismissed: counts.dismissed };
  const markAll = async () => {
    if (toastResult(await markAllPostingsSeen({ filters })).ok) router.refresh();
  };
  const countryName = (code: string) => countries.find((country) => country.code === code)?.name ?? code.toUpperCase();
  const tabs: ListingTab[] = [
    ...LIBRARY_SHOWS.map((option) => ({ key: option.value, label: option.value === "open" ? "All open" : option.label, count: countOf[option.value], href: libraryHref({ ...filters, tab: "positions", show: option.value }) })),
    // The Archive (E22-7, PL2): the sixth tab, with the same filters on what was left untouched.
    { key: "archive", label: "Archive", count: counts.archived, href: libraryHref({ ...filters, tab: "archive", show: "open" }) },
  ];
  const found = [
    { value: "", label: "any" },
    { value: FOUND_BY_AGENT, label: "the job agent" },
    // A link from an agent run's notification (E26-4): its searches together.
    ...(filters.found?.includes(",") ? [{ value: filters.found, label: "one of the agent's runs" }] : []),
    ...searches.flatMap((day) => day.searches.map((search) => ({ value: search.id, label: `${describeSearch(search.query, countryName(search.query.country), search.source)} · ${day.day} ${search.time}` }))),
  ];
  return (
    <div className="flex flex-col gap-2 border-b border-line px-10">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <ListingTabs label="Where they stand" current={filters.tab === "archive" ? "archive" : filters.show} tabs={tabs} />
        <div className="flex flex-wrap items-center gap-3 pb-2">
          <FilterChips>
            <FilterChip label="Found by" value={filters.found ?? ""} options={found} onChange={(value) => go({ found: value || null })} />
            <FilterChip label="Portal" value={filters.portal ?? ""} options={[{ value: "", label: "any" }, ...knownPortals().map((portal) => ({ value: portal.id, label: portal.name }))]} onChange={(value) => go({ portal: value || null })} />
            <FilterChip label="Posted within" value={filters.age} options={POSTED_WITHIN.map((option) => ({ value: option.value, label: option.value === "any" ? "any time" : option.label.toLowerCase() }))} onChange={(value) => go({ age: value })} />
            {profiles.length > 1 && (
              <FilterChip label="Fits" value={filters.fits ?? ""} options={[{ value: "", label: "any profile" }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]} onChange={(value) => go({ fits: value || null })} />
            )}
            <FilterChip label="Covers" value={filters.covers} options={COVERS.map((value) => ({ value, label: value === "any" ? "any" : COVERS_LABELS[value].toLowerCase() }))} onChange={(value) => go({ covers: value })} />
          </FilterChips>
          <FilterChip label="Sort" value={filters.sort} options={[{ value: "fit", label: "Best fit" }, { value: "new", label: "Newest" }]} onChange={(value) => go({ sort: value })} />
        </div>
      </div>
      {(filters.tab === "archive" || (counts.new > 0 && filters.show !== "dismissed")) && (
        <p className="pb-2.5 text-meta text-muted">
          {filters.tab === "archive" ? (
            <>
              Postings you didn&apos;t save, apply for or dismiss move here {archiveDays} days after a search last found them. Nothing here is removed unless you remove it.{" "}
              <Link href={SETTINGS_HREF} className="underline underline-offset-2 hover:text-ink">
                Change the days
              </Link>
            </>
          ) : (
            <button type="button" onClick={() => void markAll()} className="underline underline-offset-3 hover:text-ink">
              Mark all as seen
            </button>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * The search "Found by" names (E22-4): what it asked and when, its portals'
 * progress, and Search again, Show more and Remove. While portals are still
 * searching, each answer refreshes the page.
 */
function FoundSearch({ search }: { search: StoredSearch }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  // A burst of updates (a portal searching, then done, then the job done) is one refresh, after the last:
  // refreshes started together can land out of order, and an early one would show the search half-kept.
  const soon = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(soon.current), []);
  useJob(search.jobId, 0, () => {
    clearTimeout(soon.current);
    soon.current = setTimeout(() => router.refresh(), 250);
  });
  // And while the server still says it's searching, ask again every 2 seconds, so a refresh
  // that landed out of order is put right; it stops once every portal has answered.
  const stillSearching = search.portals.some((portal) => portal.status === "waiting" || portal.status === "searching");
  useEffect(() => {
    if (!stillSearching) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [stillSearching, router]);
  const withMore = search.portals.filter((portal) => portal.next);
  const searching = search.portals.some((portal) => portal.status === "waiting" || portal.status === "searching");
  const more = async () => {
    if (loading) return;
    setLoading(true);
    const result = await showMorePostings({ searchId: search.id });
    setLoading(false);
    if (!result.ok) return void toast(result.error);
    if (!result.data.ok) return void toast(result.data.message);
    router.refresh();
  };
  const retry = async (portal: string) => {
    if (toastResult(await retryPortalSearch({ searchId: search.id, portal })).ok) router.refresh();
  };
  const remove = async () => {
    if (toastResult(await removeJobSearch({ id: search.id })).ok) router.push(libraryHref({}), { scroll: false });
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta text-muted">
        {withMore.length > 0 && !searching && (
          <button type="button" onClick={() => void more()} aria-disabled={loading || undefined} className="underline underline-offset-3 hover:text-ink aria-disabled:text-faint">
            {loading ? "Asking for more…" : withMore.length === 1 ? `More from ${sourceInfo(withMore[0].id).name}` : "Show more"}
          </button>
        )}
        <button type="button" onClick={() => void remove()} className="underline underline-offset-3 hover:text-ink">
          Remove this search
        </button>
      </p>
      {search.portals.length > 1 || searching || search.portals.some((portal) => portal.status !== "done" || portal.message) ? <PortalsProgress portals={search.portals} onRetry={(id) => void retry(id)} /> : null}
    </div>
  );
}

/** What a portal's status says, in words. */
function portalStatus(portal: SearchPortal): string {
  if (portal.status === "waiting") return "Waiting";
  if (portal.status === "searching") return "Searching…";
  if (portal.status === "done") return `${portal.found === 1 ? "1 posting" : `${portal.found} postings`}${portal.message ? ` · ${portal.message}` : ""}`;
  return portal.message ?? (portal.status === "failed" ? "Didn't answer." : "Skipped.");
}

/**
 * A search's progress (E22-4): the line and a bar, and each portal's status,
 * shown on hover, on keyboard focus, or on a tap, with Try again for one
 * that failed.
 */
function PortalsProgress({ portals, onRetry }: { portals: SearchPortal[]; onRetry: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const asked = portals.filter((portal) => portal.status !== "skipped");
  const finished = asked.filter((portal) => portal.status === "done" || portal.status === "failed").length;
  const share = asked.length === 0 ? 100 : Math.round((finished / asked.length) * 100);
  return (
    <div
      className="relative max-w-[560px]"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} className="flex w-full flex-col gap-1.5 text-left">
        <span role="status" className="text-meta text-ink">
          {portalsLine(portals)}
        </span>
        <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-track">
          <span className="block h-full rounded-full bg-primary motion-safe:transition-[width]" style={{ width: `${share}%` }} />
        </span>
      </button>
      {open && (
        <ul id={listId} aria-label="Each portal" className="absolute top-full left-0 z-20 mt-2 flex w-full flex-col gap-2 rounded-card border border-line-card bg-card p-3 shadow-lg">
          {portals.map((portal) => (
            <li key={portal.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-meta">
              <span className="font-medium text-ink">{sourceInfo(portal.id).name}</span>
              <span className={cn("text-muted", portal.status === "failed" && "text-error")}>
                {portalStatus(portal)}
                {portal.status === "failed" && (
                  <>
                    {" "}
                    <button type="button" onClick={() => onRetry(portal.id)} className="text-ink underline underline-offset-3">
                      Try again <span className="sr-only">{sourceInfo(portal.id).name}</span>
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Before a portal is on: where to switch one on. The library still shows what earlier searches found. */
function NoSource() {
  return (
    <div className="mx-10 mb-7 flex max-w-[640px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-7">
      <h2 className="font-serif text-section">Choose where to search</h2>
      <p className="text-sm text-muted">
        Positions searches the job portals you switch on, such as JSearch (LinkedIn, Indeed and more), Adzuna or FreeHire. Switch them on in Settings. Until
        then, nothing is sent anywhere.
      </p>
      <Link href={SETTINGS_HREF} className={buttonClassName("primary", "md", "mt-1 hover:text-on-primary")}>
        Set up job search
      </Link>
    </div>
  );
}

/** A search that didn't work, and what to do about it. */
function SearchProblem({ problem, message, onRetry }: { problem: Problem["problem"]; message: string; onRetry: () => void }) {
  const toSettings = problem === "no-key" || problem === "key" || problem === "country" || problem === "changed" || problem === "off";
  return (
    <div role="alert" className="mx-10 mb-16 flex max-w-[640px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-6">
      <p className="text-sm">{message}</p>
      {toSettings ? (
        <Link href={SETTINGS_HREF} className={buttonClassName("secondary", "sm")}>
          Open Settings → Job search
        </Link>
      ) : problem === "unavailable" ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
