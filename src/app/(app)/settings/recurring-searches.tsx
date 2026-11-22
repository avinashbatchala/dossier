"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { agentSearchInputSchema, MAX_AGENT_SEARCHES, type SavedAgentSearch } from "@/lib/agent/search";
import type { Country } from "@/lib/job-search/countries";
import { EMPTY_QUERY, searchHref, type JobSource, type SearchQuery } from "@/lib/job-search/search";

import { deleteRecurringSearch, moveRecurringSearch, saveRecurringSearch, setRecurringSearchEnabled } from "../agent/actions";
import { RemoteOnlyField, SearchFields } from "../jobs/search-fields";

/** A profile a search can be tied to (E24-6), with the filters a search for it starts with. */
export type SearchProfile = { id: string; name: string; defaults: Partial<SearchQuery> };

export function RecurringSearches({ initial, suggestedQuery, sources, countries, profiles = [] }: {
  initial: SavedAgentSearch[];
  suggestedQuery?: SearchQuery;
  /** The portals the agent asks (#517): a search goes to all of them. */
  sources: readonly JobSource[];
  countries: readonly Country[];
  profiles?: SearchProfile[];
}) {
  const router = useRouter();
  const track = useTrackSave();
  const [searches, setSearches] = useState(initial);
  const [received, setReceived] = useState(initial);
  const [editing, setEditing] = useState<SavedAgentSearch | "new" | null>(null);
  const [deleting, setDeleting] = useState<SavedAgentSearch | null>(null);
  const [pending, startTransition] = useTransition();

  // Adopt a new server snapshot once, not on local renders after mutations.
  // The editor's keyed draft remains mounted so refreshes do not erase typing.
  if (received !== initial) {
    setReceived(initial);
    setSearches(initial);
  }
  const controlName = (search: SavedAgentSearch, index: number) => searches.filter((row) => row.name === search.name).length > 1
    ? `${search.name} (search ${index + 1})`
    : search.name;

  const update = (saved: SavedAgentSearch) => {
    setSearches((rows) => rows.some((row) => row.id === saved.id) ? rows.map((row) => row.id === saved.id ? saved : row) : [...rows, saved]);
    router.refresh();
  };
  const toggle = (search: SavedAgentSearch, enabled: boolean) => startTransition(async () => {
    const result = toastResult(await track(setRecurringSearchEnabled({ id: search.id, enabled })));
    if (result.ok) update(result.data);
  });
  const move = (id: string, direction: "up" | "down") => startTransition(async () => {
    const result = toastResult(await track(moveRecurringSearch({ id, direction })));
    if (!result.ok) return;
    setSearches(result.data);
    router.refresh();
  });

  return (
    <Card padding="none" className="flex flex-col gap-4 px-7 py-[26px]">
    <div>
      <h3 className="text-field font-medium">Recurring searches ({searches.length}/{MAX_AGENT_SEARCHES})</h3>
      <p className="text-meta text-muted">
        Up to {MAX_AGENT_SEARCHES} named searches, including disabled ones. Enabled searches run in this order, each through the portals switched on in Settings → Job search.
        Saved, dismissed and applied-for postings stay out of the review queue.
      </p>
    </div>
    <ol className="flex flex-col gap-4">
      {searches.map((search, index) => (
        <li key={search.id} className="flex flex-col gap-3 border-t border-line pt-4">
          <Toggle
            label={<span className="[overflow-wrap:anywhere]">{search.name}</span>}
            aria-label={controlName(search, index)}
            description={search.enabled ? "Enabled" : "Disabled"}
            checked={search.enabled}
            disabled={pending || editing !== null}
            onCheckedChange={(enabled) => toggle(search, enabled)}
          />
          <Link href={searchHref(search.query)} className="text-meta text-muted break-words underline underline-offset-2">
            Preview {controlName(search, index)} in Find jobs
          </Link>
          <p className="text-meta text-muted break-words">
            {search.query.keywords}{search.query.place ? ` · ${search.query.place}` : ""} · {search.query.country.toUpperCase() || "Choose a country"}
            {profiles.length > 1 && ` · ${search.allProfiles ? "All profiles" : (profiles.find((profile) => profile.id === search.profileId) ?? profiles[0]).name}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" aria-label={`Edit ${controlName(search, index)}`} disabled={pending || editing !== null} onClick={() => setEditing(search)}>
              Edit
            </Button>
            {(["up", "down"] as const).map((direction) => (
              <Button
                key={direction}
                variant="secondary"
                size="sm"
                aria-label={`Move ${direction}: ${controlName(search, index)}`}
                disabled={pending || editing !== null || (direction === "up" ? index === 0 : index === searches.length - 1)}
                onClick={() => move(search.id, direction)}
              >
                Move {direction}
              </Button>
            ))}
            <Button variant="danger-text" size="sm" aria-label={`Delete ${controlName(search, index)}`} disabled={pending || editing !== null} onClick={() => setDeleting(search)}>
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ol>
    {editing !== null ? (
      <SearchEditor
        key={typeof editing === "string" ? editing : editing.id}
        search={editing === "new" ? null : editing}
        suggestedQuery={suggestedQuery}
        sort={searches.reduce((max, row) => Math.max(max, row.sort + 1), 0)}
        sources={sources}
        countries={countries}
        profiles={profiles}
        onCancel={() => setEditing(null)}
        onSave={(saved) => {
          update(saved);
          setEditing(null);
        }}
      />
    ) : (
      <Button variant="secondary" disabled={pending || searches.length >= MAX_AGENT_SEARCHES} onClick={() => setEditing("new")}>
        Add search
      </Button>
    )}
    <ConfirmDialog
      open={deleting !== null}
      onOpenChange={(open) => !open && setDeleting(null)}
      title={`Delete “${deleting?.name ?? "search"}”?`}
      description="Existing candidates and their historical search labels stay in the review queue. This does not delete saved postings or applications."
      confirmLabel="Delete search"
      onConfirm={() => {
        if (!deleting) return;
        const id = deleting.id;
        startTransition(async () => {
          const result = toastResult(await track(deleteRecurringSearch({ id })));
          if (!result.ok) return;
          setSearches((rows) => rows.filter((row) => row.id !== id));
          setDeleting(null);
          router.refresh();
        });
      }}
    />
    </Card>
  );
}

function SearchEditor({ search, suggestedQuery, sort, sources, countries, profiles, onCancel, onSave }: {
  search: SavedAgentSearch | null;
  suggestedQuery?: SearchQuery;
  sort: number;
  /** The portals the agent asks (#517): a search goes to all of them. */
  sources: readonly JobSource[];
  countries: readonly Country[];
  profiles: SearchProfile[];
  onCancel: () => void;
  onSave: (search: SavedAgentSearch) => void;
}) {
  const track = useTrackSave();
  const [name, setName] = useState(search?.name ?? "");
  // Tied to a profile (E24-6): the first unless it says another. A new search starts with its profile's filters.
  const [profileId, setProfileId] = useState(search?.profileId ?? profiles[0]?.id ?? null);
  // Or every profile (E25-5): the filters stay as they are.
  const [allProfiles, setAllProfiles] = useState(search?.allProfiles ?? false);
  const startsWith = (id: string | null) => profiles.find((profile) => profile.id === id)?.defaults ?? {};
  const [query, setQuery] = useState<SearchQuery>(search?.query ?? { ...(suggestedQuery ?? EMPTY_QUERY), ...startsWith(profileId) });
  const [enabled, setEnabled] = useState(search?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const patch = (change: Partial<SearchQuery>) => setQuery((current) => ({ ...current, ...change }));
  return <form aria-label={search ? `Edit ${search.name}` : "New recurring search"} className="flex flex-col gap-4 border-t border-line pt-4" onSubmit={(event) => {
    event.preventDefault();
    const input = { name, query, enabled, sort: search?.sort ?? sort, profileId, allProfiles };
    const parsed = agentSearchInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (enabled && !query.country) {
      setError("Choose a country for an enabled search.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = toastResult(await track(saveRecurringSearch({ ...input, id: search?.id })));
      if (result.ok) onSave(result.data);
      else setError(result.error);
    });
  }}>
    <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
      <legend className="mb-3 text-field font-medium">{search ? "Edit search" : "Add recurring search"}</legend>
       <Input label="Search name" value={name} maxLength={100} autoFocus onChange={(event) => setName(event.target.value)} />
       {profiles.length > 1 && (
         <Select
           label="Profile"
           hint={
             allProfiles
               ? "Scores each posting once per profile, so 3 profiles cost 3 times as much. Drafts use the profile that scored best."
               : "It scores and drafts with this profile. Choosing one fills in its levels and where it wants to work; change them as you like."
           }
           value={allProfiles ? "all" : (profileId ?? "")}
           onChange={(event) => {
             if (event.target.value === "all") return setAllProfiles(true);
             setAllProfiles(false);
             setProfileId(event.target.value);
             patch(startsWith(event.target.value));
           }}
         >
           {profiles.map((profile) => (
             <option key={profile.id} value={profile.id}>
               {profile.name}
             </option>
           ))}
           <option value="all">All profiles</option>
         </Select>
       )}
       <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
         <SearchFields value={query} onChange={patch} sources={sources} countries={countries} />
       </div>
      <RemoteOnlyField value={query} onChange={patch} sources={sources} />
      <Toggle label="Enable this search" checked={enabled} onCheckedChange={setEnabled} />
       {error && <p role="alert" className="text-meta text-error">{error}</p>}
       <div className="flex flex-wrap gap-2">
         <Button type="submit">{pending ? "Saving…" : "Save search"}</Button>
         <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
       </div>
    </fieldset>
  </form>;
}
