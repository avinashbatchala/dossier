"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Country } from "@/lib/job-search/countries";
import {
  POSTED_WITHIN,
  RADII_KM,
  type JobSource,
  type RadiusKm,
  type SearchQuery,
} from "@/lib/job-search/search";
import { SOURCE_INFO } from "@/lib/job-search/sources";

import { saveAgentSettings } from "@/lib/agent/actions";
import { SettingsSectionIntro } from "./settings-screen";

export type AgentSettingsInitial = {
  enabled: boolean;
  query: SearchQuery;
  hour: number;
  minScore: number;
  maxScores: number;
  maxDrafts: number;
  autoDraft: boolean;
};

/** Settings → Job agent (E16): one search, a daily schedule and hard caps. */
export function AgentSection({
  initial,
  source,
  countries,
}: {
  initial: AgentSettingsInitial;
  source: JobSource | null;
  countries: readonly Country[];
}) {
  const track = useTrackSave();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (patch: Partial<AgentSettingsInitial>) => setForm((current) => ({ ...current, ...patch }));
  const setQuery = (patch: Partial<SearchQuery>) => setForm((current) => ({ ...current, query: { ...current.query, ...patch } }));
  const sourceName = source ? SOURCE_INFO[source].name : null;

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = toastResult(
        await track(
          saveAgentSettings({
            enabled: form.enabled,
            query: { ...form.query, keywords: form.query.keywords.trim(), place: form.query.place.trim() },
            hour: form.hour,
            minScore: form.minScore,
            maxScores: form.maxScores,
            maxDrafts: form.maxDrafts,
            autoDraft: form.autoDraft,
          }),
        ),
      );
      if (!result.ok) setError(result.error);
    });

  return (
    <>
      <SettingsSectionIntro title="Job agent">
        One saved search that runs by itself, scores new postings against your profile, and prepares drafts for the best ones. It
        never sends or applies for you.
      </SettingsSectionIntro>

      {!source ? (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          The agent uses the source from <Link href="/settings?section=jobs" className="underline">Settings → Job search</Link>. Choose one
          there first.
        </p>
      ) : (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          Searches go to {sourceName}, using the same key as Find jobs. Each run asks for one page and runs at most three times a day.
          {source === "JSEARCH"
            ? " JSearch's free plan allows 200 searches a month; the agent uses at most about 90."
            : source === "ADZUNA"
              ? " Adzuna allows about 250 searches a day, so three runs is a small share."
              : " The Bundesagentur für Arbeit needs no key, but the agent still keeps to three runs a day."}
        </p>
      )}

      <Card className="flex flex-col gap-5">
        <Checkbox
          label="Run the job agent every day"
          checked={form.enabled}
          onChange={(event) => set({ enabled: event.target.checked })}
          hint="Off until you turn it on. A manual run on the Agent screen still works when it's on."
        />

        <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
          <Input
            label="What"
            value={form.query.keywords}
            placeholder="Job title, skill or company"
            onChange={(event) => setQuery({ keywords: event.target.value })}
            error={form.enabled && !form.query.keywords.trim() ? "Type what the agent should look for." : undefined}
          />
          <Input
            label="Where"
            value={form.query.place}
            placeholder="City or region (optional)"
            onChange={(event) => setQuery({ place: event.target.value })}
          />
          <Select
            label="Country"
            value={form.query.country}
            error={form.enabled && !form.query.country ? "Choose a country." : undefined}
            onChange={(event) => setQuery({ country: event.target.value })}
          >
            <option value="">Choose a country</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
          <Select
            label="Within"
            value={String(form.query.radiusKm)}
            disabled={!form.query.place.trim()}
            hint={form.query.place.trim() ? undefined : "Add a place first"}
            onChange={(event) => setQuery({ radiusKm: Number(event.target.value) as RadiusKm })}
          >
            {RADII_KM.map((km) => (
              <option key={km} value={km}>
                {km} km
              </option>
            ))}
          </Select>
          <Select
            label="Posted"
            value={form.query.postedWithin}
            onChange={(event) => setQuery({ postedWithin: event.target.value as SearchQuery["postedWithin"] })}
          >
            {POSTED_WITHIN.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="Run at"
            value={String(form.hour)}
            hint="Server time"
            onChange={(event) => set({ hour: Number(event.target.value) })}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </Select>
        </div>

        <Checkbox
          label="Remote only"
          checked={form.query.remoteOnly}
          onChange={(event) => setQuery({ remoteOnly: event.target.checked })}
        />

        <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-3">
          <Input
            label="Minimum score"
            type="number"
            min={0}
            max={100}
            value={form.minScore}
            hint="0–100. Lower means more drafts."
            onChange={(event) => set({ minScore: Number(event.target.value) })}
          />
          <Input
            label="Score at most"
            type="number"
            min={1}
            max={30}
            value={form.maxScores}
            hint="Postings per run."
            onChange={(event) => set({ maxScores: Number(event.target.value) })}
          />
          <Input
            label="Draft at most"
            type="number"
            min={0}
            max={10}
            value={form.maxDrafts}
            hint="Per run. 0 keeps the agent score-only."
            onChange={(event) => set({ maxDrafts: Number(event.target.value) })}
          />
        </div>

        <Checkbox
          label="Prepare drafts automatically"
          checked={form.autoDraft}
          onChange={(event) => set({ autoDraft: event.target.checked })}
          hint="Off means a run only scores postings; you choose which ones to turn into drafts."
        />

        <div className="flex flex-wrap items-center gap-3.5 pt-1">
          <Button onClick={() => void save()} disabled={pending}>
            {pending ? "Saving…" : "Save job agent"}
          </Button>
          {error && (
            <p role="alert" className="text-label text-error">
              {error}
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
