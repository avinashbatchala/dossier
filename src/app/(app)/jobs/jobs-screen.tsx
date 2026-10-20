"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { Country } from "@/lib/job-search/countries";
import {
  searchHref,
  searchRunHref,
  viewHref,
  type JobSource,
  type JobsView,
  type PastSearchDay,
  type SearchProblem as Problem,
  type SearchQuery,
  type ShownPosting,
  type StoredSearch,
} from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import { runJobSearch } from "./actions";
import { PastSearches } from "./past-searches";
import { PostingResults } from "./posting-results";
import { RemoteOnlyField, SearchFields, uncoveredCountry } from "./search-fields";

export type JobsScreenProps = {
  /** The source chosen in Settings; null while job search is off. */
  source: JobSource | null;
  /** Every country by name, named on the server. */
  countries: readonly Country[];
  /** The search, past searches, or the Saved or Dismissed postings. */
  view: JobsView;
  /** What the form starts from: the open search, else the last one, else the profile's. */
  query: SearchQuery;
  /** The kept search that's open (E14-10): the one in the URL, else the latest. */
  search: StoredSearch | null;
  /** The URL names a search that's no longer kept. */
  missingSearch?: boolean;
  /** The Saved or Dismissed postings, in those views. */
  kept?: ShownPosting[];
  /** Past searches by day, in that view. */
  history?: PastSearchDay[];
  /** How many searches, saved and dismissed postings there are, for the tabs. */
  counts: { searches: number; saved: number; dismissed: number };
  /** Now, from the server, so "3 days ago" reads the same on both sides. */
  today: string;
};

const SETTINGS_HREF = "/settings?section=jobs";

/** Find jobs (E14-6, E14-7, E14-10): the search form and a kept search's postings, past searches, or the postings kept from them. */
export function JobsScreen({ source, countries, view, query, search, missingSearch = false, kept = [], history = [], counts, today }: JobsScreenProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // A search that didn't work, with what was asked, for Try again.
  const [failed, setFailed] = useState<{ problem: Problem; query: SearchQuery } | null>(null);
  const header = (
    <>
      <PageHeader
        title="Find jobs"
        description={`Search ${source ? SOURCE_INFO[source].name : "job postings"} for postings near you, then start an application from the one you like.`}
      />
      <ViewTabs view={view} counts={counts} />
    </>
  );

  if (view === "history") {
    return (
      <>
        {header}
        <PastSearches days={history} countries={countries} />
      </>
    );
  }

  if (view !== "search") {
    return (
      <>
        {header}
        <PostingResults key={view} mode={view} postings={kept} today={today} />
      </>
    );
  }

  if (!source) {
    return (
      <>
        {header}
        <NoSource />
      </>
    );
  }

  // Each search is kept and gets its own history entry, so Back returns to it without asking the source again.
  const run = (next: SearchQuery) =>
    startTransition(async () => {
      const result = await runJobSearch({ query: next });
      if (!result.ok) return void toast(result.error);
      if (!result.data.ok) return void setFailed({ problem: result.data, query: next });
      setFailed(null);
      router.push(searchRunHref(result.data.id), { scroll: false });
    });

  return (
    <>
      {header}
      <SearchForm source={source} countries={countries} query={query} pending={pending} onSearch={run} />
      {/* Announces each new set of results; the list itself is replaced. */}
      <p role="status" className="sr-only">
        {pending ? "Searching…" : failed ? failed.problem.message : search ? `${search.postings.length} postings found.` : ""}
      </p>
      <div className={cn("flex flex-1 flex-col motion-safe:transition-opacity", pending && "opacity-60")} aria-busy={pending || undefined}>
        {failed ? (
          <SearchProblem problem={failed.problem.problem} message={failed.problem.message} onRetry={() => run(failed.query)} />
        ) : search ? (
          <PostingResults key={search.id} mode="search" search={search} today={today} onSearchAgain={() => run(search.query)} searching={pending} />
        ) : (
          <p className="px-10 pb-16 text-sm text-muted">
            {missingSearch
              ? "That search is no longer kept. Search again, or open one from Past searches."
              : "Search for a role, a skill or a company. Every search is kept with what it found, so you can come back to it without spending another search."}
          </p>
        )}
      </div>
    </>
  );
}

function SearchForm({
  source,
  countries,
  query,
  pending,
  onSearch,
}: {
  source: JobSource;
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
  const uncovered = uncoveredCountry(source, form, countries);

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
      className="mx-10 mb-7 grid grid-cols-1 items-start gap-x-4 gap-y-4 rounded-panel border border-line-card bg-card p-6 sm:grid-cols-2 lg:grid-cols-[2fr_1.5fr_1.3fr_1fr_1fr]"
    >
      <SearchFields value={form} onChange={set} source={source} countries={countries} errors={errors} />
      <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2 lg:col-span-5">
        <RemoteOnlyField value={form} onChange={set} source={source} />
        <Button type="submit" aria-disabled={pending || undefined}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </div>
    </form>
  );
}

/** Search, Past searches (E14-10), Saved and Dismissed (E14-7), with how many each holds. */
function ViewTabs({ view, counts }: { view: JobsView; counts: { searches: number; saved: number; dismissed: number } }) {
  const tabs = [
    // The latest search, as it was kept.
    { view: "search", label: "Search", href: "/jobs", count: null },
    { view: "history", label: "Past searches", href: viewHref("history"), count: counts.searches },
    { view: "saved", label: "Saved", href: viewHref("saved"), count: counts.saved },
    { view: "dismissed", label: "Dismissed", href: viewHref("dismissed"), count: counts.dismissed },
  ] as const;
  return (
    <nav aria-label="Find jobs views" className="flex flex-wrap gap-1.5 px-10 pb-[18px]">
      {tabs.map((tab) => (
        <Link
          key={tab.view}
          href={tab.href}
          aria-current={tab.view === view ? "page" : undefined}
          className={cn(
            "flex items-baseline gap-1.5 rounded-control border px-3 py-2 text-control",
            tab.view === view ? "border-primary bg-selected font-medium text-primary-text hover:text-primary-text" : "border-line-field bg-card text-ink hover:border-line-strong hover:bg-hover hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== null && <span className="text-xs opacity-65">{tab.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Before a source is chosen: where to set one up. */
function NoSource() {
  return (
    <div className="mx-10 mb-16 flex max-w-[640px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-7">
      <h2 className="font-serif text-section">Choose where to search</h2>
      <p className="text-sm text-muted">
        Find jobs searches one job source for you: JSearch (LinkedIn, Indeed and more), Adzuna, or Germany&apos;s Bundesagentur für Arbeit. Pick
        one in Settings. Until then, nothing is sent anywhere.
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
