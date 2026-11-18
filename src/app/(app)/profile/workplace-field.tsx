"use client";

import { useEffect, useId, useState } from "react";

import { toastResult } from "@/components/toast";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Country } from "@/lib/job-search/countries";
import { RADII_KM } from "@/lib/job-search/search";
import { placesFrom, REMOTE_OPEN_TO, WORK_MODES, type RemoteOpenTo, type Workplace, type WorkMode } from "@/lib/profile-workplace";

import { sawProfileWorkplace, setProfileWorkplace } from "./profiles-actions";

/**
 * Where a profile wants to work (E24-4), in four answers, saved as they
 * change; text fields save when they lose focus. Opening it counts as
 * having looked at it, so the Profile page stops asking.
 */
export function WorkplaceField({
  profileId,
  initial,
  seen,
  city,
  country,
  countries,
  onSeen,
}: {
  profileId: string;
  initial: Workplace;
  seen: boolean;
  /** The shared address's city and country, which the answers refer to. */
  city: string;
  country: string;
  countries: readonly Country[];
  onSeen: () => void;
}) {
  const [workplace, setWorkplace] = useState(initial);
  const [otherPlaces, setOtherPlaces] = useState(initial.otherPlaces.join("\n"));
  const [relocatePlaces, setRelocatePlaces] = useState(initial.relocatePlaces.join("\n"));
  const [problem, setProblem] = useState<string | null>(null);
  const modesId = useId();
  const remoteId = useId();
  const moveId = useId();

  useEffect(() => {
    if (seen) return;
    void sawProfileWorkplace({ profileId }).then((result) => result.ok && onSeen());
  }, [seen, profileId, onSeen]);

  const save = async (next: Workplace) => {
    setWorkplace(next);
    if (next.modes.length === 0) return setProblem("Choose at least one way of working.");
    setProblem(null);
    toastResult(await setProfileWorkplace({ profileId, workplace: next }));
  };

  const hasMode = (mode: WorkMode) => workplace.modes.includes(mode);
  const toggleMode = (mode: WorkMode, on: boolean) =>
    void save({ ...workplace, modes: WORK_MODES.map((entry) => entry.value).filter((value) => (value === mode ? on : workplace.modes.includes(value))) });
  const countryName = (code: string) => countries.find((entry) => entry.code === code)?.name ?? code.toUpperCase();
  const local = hasMode("ONSITE") || hasMode("HYBRID");

  return (
    <fieldset className="flex flex-col gap-5">
      <legend className="mb-1 text-[15px] font-medium">Where it wants to work</legend>
      <p className="text-meta text-pretty text-muted">
        Scoring weighs where a posting is against these. A posting on-site somewhere this profile can&apos;t go, and won&apos;t move to, fits least.
      </p>

      <div role="group" aria-labelledby={modesId} className="flex flex-col gap-2">
        <span id={modesId} className="text-label font-medium">
          Ways of working it takes
        </span>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {WORK_MODES.map((mode) => (
            <Checkbox key={mode.value} label={mode.label} checked={hasMode(mode.value)} onChange={(event) => toggleMode(mode.value, event.target.checked)} />
          ))}
        </div>
        {problem && (
          <p role="alert" className="text-label text-error">
            {problem}
          </p>
        )}
      </div>

      {local && (
        <div className="flex flex-col gap-3">
          <Select
            label="On-site and hybrid: how far from home"
            hint={city ? `From ${city}, the city in your basics.` : "From the city in your basics, once you add it there."}
            value={String(workplace.radiusKm)}
            onChange={(event) => void save({ ...workplace, radiusKm: Number(event.target.value) as Workplace["radiusKm"] })}
          >
            {RADII_KM.map((km) => (
              <option key={km} value={km}>
                Within {km} km
              </option>
            ))}
          </Select>
          <Textarea
            label="Other cities or countries"
            hint="Optional. One a line, such as Berlin or the Netherlands."
            rows={2}
            value={otherPlaces}
            onChange={(event) => setOtherPlaces(event.target.value)}
            onBlur={() => {
              const places = placesFrom(otherPlaces);
              if (places.join("\n") !== workplace.otherPlaces.join("\n")) void save({ ...workplace, otherPlaces: places });
            }}
          />
        </div>
      )}

      {hasMode("REMOTE") && (
        <div className="flex flex-col gap-2">
          <span id={remoteId} className="text-label font-medium">
            Remote, for
          </span>
          <SegmentedControl<RemoteOpenTo>
            aria-labelledby={remoteId}
            size="sm"
            options={REMOTE_OPEN_TO.map((option) => ({ value: option.value, label: option.value === "country" && country ? `Employers in ${country}` : option.label }))}
            value={workplace.remoteOpenTo}
            onValueChange={(value) => void save({ ...workplace, remoteOpenTo: value })}
          />
          {workplace.remoteOpenTo === "countries" && (
            <div className="flex flex-col gap-2">
              <ul className="flex flex-wrap gap-2" aria-label="Countries">
                {workplace.remoteCountries.map((code) => (
                  <li key={code} className="flex items-center gap-1 rounded-full bg-track py-0.5 pr-1 pl-2.5 text-meta">
                    {countryName(code)}
                    <button
                      type="button"
                      className="rounded-full px-1.5 text-muted hover:text-ink"
                      onClick={() => void save({ ...workplace, remoteCountries: workplace.remoteCountries.filter((entry) => entry !== code) })}
                    >
                      ×{" "}
                      <span className="sr-only">Remove {countryName(code)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Select
                label="Add a country"
                value=""
                onChange={(event) => event.target.value && void save({ ...workplace, remoteCountries: [...workplace.remoteCountries, event.target.value] })}
                className="max-w-[320px]"
              >
                <option value="">Choose…</option>
                {countries
                  .filter((entry) => !workplace.remoteCountries.includes(entry.code))
                  .map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span id={moveId} className="text-label font-medium">
          Willing to move
        </span>
        <SegmentedControl<"no" | "yes">
          aria-labelledby={moveId}
          size="sm"
          options={[
            { value: "no", label: "No" },
            { value: "yes", label: "Yes, to" },
          ]}
          value={workplace.relocate ? "yes" : "no"}
          onValueChange={(value) => void save({ ...workplace, relocate: value === "yes" })}
        />
        {workplace.relocate && (
          <Textarea
            label="Where to"
            hint="One a line: countries or cities."
            rows={2}
            value={relocatePlaces}
            onChange={(event) => setRelocatePlaces(event.target.value)}
            onBlur={() => {
              const places = placesFrom(relocatePlaces);
              if (places.join("\n") !== workplace.relocatePlaces.join("\n")) void save({ ...workplace, relocatePlaces: places });
            }}
          />
        )}
      </div>
    </fieldset>
  );
}
