"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { Country } from "@/lib/job-search/countries";
import { describeSearch, searchRunHref, type PastSearchDay } from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import { removeJobSearch } from "./actions";

/**
 * Past searches (E14-10): every kept search, newest first, grouped by the day
 * it ran. Opening one shows what it found without asking the source again.
 */
export function PastSearches({ days, countries }: { days: PastSearchDay[]; countries: readonly Country[] }) {
  const router = useRouter();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const shown = days.map((day) => ({ ...day, searches: day.searches.filter((search) => !removed.has(search.id)) })).filter((day) => day.searches.length > 0);
  const countryName = (code: string) => countries.find((country) => country.code === code)?.name ?? code.toUpperCase();

  const remove = async (id: string) => {
    setRemoved((current) => new Set(current).add(id));
    const result = toastResult(await removeJobSearch({ id }));
    if (!result.ok) {
      setRemoved((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      return;
    }
    // The tab's count follows.
    router.refresh();
  };

  if (shown.length === 0) {
    return (
      <div className="mx-10 mb-16 max-w-[860px] rounded-panel border border-line-card bg-card px-5 py-9 text-center text-sm text-muted">
        No searches yet. Each search you run is kept here with what it found, so you can open it again without spending another search.
      </div>
    );
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-6 px-10 pb-16">
      {shown.map((day) => (
        <section key={day.day} aria-label={day.day} className="flex flex-col gap-2">
          <h2 className="text-label font-medium text-muted">{day.day}</h2>
          <ul className="flex flex-col gap-2">
            {day.searches.map((search) => {
              const what = describeSearch(search.query, countryName(search.query.country), search.source);
              return (
                <li key={search.id} className="flex items-center justify-between gap-4 rounded-card border border-line-card bg-card px-4 py-3 hover:border-line-strong">
                  <Link href={searchRunHref(search.id)} className="flex min-w-0 flex-col gap-0.5 text-ink hover:text-ink">
                    <span className="truncate text-field font-medium">{what}</span>
                    <span className="text-meta text-muted">
                      {search.time} · {search.found === 1 ? "1 posting" : `${search.found} postings`} · {SOURCE_INFO[search.source].name}
                    </span>
                  </Link>
                  <Button variant="text" size="sm" aria-label={`Remove the search “${what}” from ${search.time}`} onClick={() => void remove(search.id)}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
