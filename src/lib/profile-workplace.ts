import { z } from "zod";

import { RADII_KM, type RadiusKm } from "@/lib/job-search/search";

// Where a profile wants to work (E24-4, #405), in four answers: the ways of
// working it takes; for on-site and hybrid, how far from the city in the
// shared address and which other places; remote for employers where; and
// whether it would move. Stored, never worked out on the fly: "the city" and
// "the country" are the shared address's, whatever it says at the time.

export const WORK_MODES = [
  { value: "ONSITE", label: "On-site" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "REMOTE", label: "Remote" },
] as const;
export type WorkMode = (typeof WORK_MODES)[number]["value"];

export const REMOTE_OPEN_TO = [
  { value: "country", label: "Employers in my country" },
  { value: "countries", label: "Employers in these countries" },
  { value: "anywhere", label: "Employers anywhere" },
] as const;
export type RemoteOpenTo = (typeof REMOTE_OPEN_TO)[number]["value"];

const place = z.string().trim().min(1).max(100);

export const workplaceSchema = z.object({
  /** At least one. */
  modes: z.array(z.enum(["ONSITE", "HYBRID", "REMOTE"])).min(1, "Choose at least one way of working.").max(3),
  /** On-site and hybrid: this far from the shared address's city (the search's radius choices). */
  radiusKm: z.union(RADII_KM.map((km) => z.literal(km)) as [z.ZodLiteral<RadiusKm>, ...z.ZodLiteral<RadiusKm>[]]),
  /** On-site and hybrid: other cities or countries too. */
  otherPlaces: z.array(place).max(20),
  /** Remote: employers in the shared address's country, in these countries, or anywhere. */
  remoteOpenTo: z.enum(["country", "countries", "anywhere"]),
  /** Country codes, for "these countries". */
  remoteCountries: z.array(z.string().regex(/^[a-z]{2}$/)).max(60),
  /** Willing to move, and where to. */
  relocate: z.boolean(),
  relocatePlaces: z.array(place).max(20),
});
export type Workplace = z.infer<typeof workplaceSchema>;

/** Where every profile starts, the migration's column default too: on-site and hybrid within 50 km of the city, remote in the country, not moving. */
export const DEFAULT_WORKPLACE: Workplace = {
  modes: ["ONSITE", "HYBRID", "REMOTE"],
  radiusKm: 50,
  otherPlaces: [],
  remoteOpenTo: "country",
  remoteCountries: [],
  relocate: false,
  relocatePlaces: [],
};

/** A profile's stored answers; what doesn't read as one reads as the defaults. */
export function workplaceFrom(stored: unknown): Workplace {
  const parsed = workplaceSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_WORKPLACE;
}

/** Places typed one a line, each once. */
export function placesFrom(text: string): string[] {
  return [...new Set(text.split(/[\n;]/).map((line) => line.trim()).filter(Boolean))].slice(0, 20);
}
