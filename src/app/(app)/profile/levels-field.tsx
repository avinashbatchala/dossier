"use client";

import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { levelRange, levelRangeLabel, PROFILE_LEVELS, type LevelRange, type ProfileLevel } from "@/lib/profile-levels";

import { guessProfileLevels, setProfileLevels } from "./profiles-actions";

export type LevelChoice = { from: ProfileLevel | ""; to: ProfileLevel | "" };

/** "From" and "To" over the search's five steps (E24-3); a range taken in order. */
export function LevelsPicker({ value, onChange }: { value: LevelChoice; onChange: (next: LevelChoice) => void }) {
  const select = (part: keyof LevelChoice, label: string) => (
    <Select label={label} value={value[part]} onChange={(event) => onChange({ ...value, [part]: event.target.value as ProfileLevel })} required>
      <option value="" disabled>
        Choose…
      </option>
      {PROFILE_LEVELS.map((level) => (
        <option key={level.value} value={level.value}>
          {level.label}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {select("from", "From")}
      {select("to", "To")}
    </div>
  );
}

/**
 * A profile's levels on the Profile page (E24-3): picked, or filled by Guess
 * with AI from its roles; saved as soon as both ends are set.
 */
export function LevelsField({ profileId, initial, onSaved }: { profileId: string; initial: LevelRange | null; onSaved: (levels: LevelRange) => void }) {
  const [value, setValue] = useState<LevelChoice>(initial ?? { from: "", to: "" });
  const [guessing, setGuessing] = useState(false);
  const saved = levelRange(value.from, value.to);

  const change = async (next: LevelChoice) => {
    setValue(next);
    const range = levelRange(next.from, next.to);
    if (!range) return;
    const result = toastResult(await setProfileLevels({ profileId, levels: range }));
    if (result.ok) onSaved(result.data);
  };

  const guess = async () => {
    setGuessing(true);
    const result = toastResult(await guessProfileLevels({ profileId }));
    setGuessing(false);
    if (!result.ok) return;
    setValue(result.data);
    onSaved(result.data);
  };

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[15px] font-medium">Levels</legend>
      <p className="text-meta text-pretty text-muted">
        The levels of job this profile is for. Scoring weighs a posting&apos;s level against them; one well outside them fits less.
      </p>
      <LevelsPicker value={value} onChange={(next) => void change(next)} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" aria-disabled={guessing || undefined} onClick={() => !guessing && void guess()}>
          {guessing ? "Guessing…" : "Guess with AI"}
        </Button>
        <p role="status" className="text-meta text-muted">
          {saved ? `For ${levelRangeLabel(saved)}.` : "Not chosen yet."}
        </p>
      </div>
    </fieldset>
  );
}
