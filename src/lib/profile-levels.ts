import { z } from "zod";

import { EXPERIENCE_LEVELS } from "@/lib/job-search/search";

// The levels a profile is for (E24-3, #404): a range over the search's five
// steps, such as "Senior to Lead or director". Set by the user, or guessed
// by AI when they ask; scoring never guesses one on its own.

export const PROFILE_LEVELS = EXPERIENCE_LEVELS.filter((level) => level.value !== "any") as readonly { value: ProfileLevel; label: string }[];
export type ProfileLevel = "intern" | "junior" | "mid" | "senior" | "lead";
const VALUES = PROFILE_LEVELS.map((level) => level.value) as [ProfileLevel, ...ProfileLevel[]];

export type LevelRange = { from: ProfileLevel; to: ProfileLevel };

/** A range from two steps, lower first; null unless both are steps. */
export function levelRange(from: unknown, to: unknown): LevelRange | null {
  const a = VALUES.indexOf(from as ProfileLevel);
  const b = VALUES.indexOf(to as ProfileLevel);
  if (a < 0 || b < 0) return null;
  return { from: VALUES[Math.min(a, b)], to: VALUES[Math.max(a, b)] };
}

/** Two steps, put in order. */
export const levelRangeSchema = z
  .object({ from: z.enum(VALUES), to: z.enum(VALUES) })
  .transform(({ from, to }) => levelRange(from, to)!);

const label = (level: ProfileLevel) => PROFILE_LEVELS.find((entry) => entry.value === level)!.label;

/** "Senior to Lead or director", or "Senior" for one step. */
export function levelRangeLabel(range: LevelRange): string {
  return range.from === range.to ? label(range.from) : `${label(range.from)} to ${label(range.to)}`;
}

/** Each step the range takes in, for a search's Level filter (E24-6). */
export function levelsIn(range: LevelRange): ProfileLevel[] {
  return VALUES.slice(VALUES.indexOf(range.from), VALUES.indexOf(range.to) + 1);
}
