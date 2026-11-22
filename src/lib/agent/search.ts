import { z } from "zod";

import { EMPTY_QUERY, searchQuerySchema, type SearchQuery } from "@/lib/job-search/search";

/** Fixed product and source-budget cap, shared by forms and server writes. */
export { MAX_AGENT_SEARCHES } from "./limits";
export const agentSearchInputSchema = z.object({
  name: z.string().trim().min(1, "Give the search a name.").max(100),
  query: searchQuerySchema.refine((query) => Boolean(query.keywords), "Add what to look for."),
  enabled: z.boolean().default(true),
  sort: z.number().int().min(0).default(0),
  /** The profile it scores and drafts with (E24-6); null reads as the first. */
  profileId: z.string().min(1).nullable().default(null),
  /** Scores against every profile instead (E25-5), once per profile; drafts with the best-scoring one. */
  allProfiles: z.boolean().default(false),
});
export type AgentSearchInput = z.input<typeof agentSearchInputSchema>;
export type SavedAgentSearch = {
  id: string;
  name: string;
  query: SearchQuery;
  enabled: boolean;
  sort: number;
  profileId: string | null;
  allProfiles: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Shared setup wording for the engine and the master enable action. */
export function agentSearchSetupProblem(searches: readonly SavedAgentSearch[]): string | null {
  if (!searches.length) return "Add what to look for in Settings → Job agent first.";
  const enabled = searches.filter((search) => search.enabled);
  if (!enabled.length) return "Enable an Agent search in Settings → Job agent first.";
  const empty = enabled.find((search) => !search.query.keywords.trim());
  if (empty) return `Add what to look for in “${empty.name}” in Settings → Job agent first.`;
  const missingCountry = enabled.find((search) => !search.query.country);
  if (missingCountry) return `Choose a country for “${missingCountry.name}” in Settings → Job agent first.`;
  return null;
}

/** Same recovery rules as the SQL upgrade: keep meaningful keywords, repair
 * optional fields and truncate the place rather than lose the whole search. */
export function legacyAgentQuery(value: string): SearchQuery | null {
  let raw: unknown;
  try { raw = JSON.parse(value); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const q = raw as Record<string, unknown>;
  const keywords = searchQuerySchema.shape.keywords.safeParse(q.keywords);
  if (!keywords.success || !keywords.data) return null;
  return {
    keywords: keywords.data,
    place: typeof q.place === "string" ? Array.from(q.place.trim()).slice(0, 200).join("").trim() : "",
    country: searchQuerySchema.shape.country.catch(EMPTY_QUERY.country).parse(q.country),
    radiusKm: searchQuerySchema.shape.radiusKm.catch(EMPTY_QUERY.radiusKm).parse(q.radiusKm),
    remoteOnly: searchQuerySchema.shape.remoteOnly.catch(EMPTY_QUERY.remoteOnly).parse(q.remoteOnly),
    postedWithin: searchQuerySchema.shape.postedWithin.catch(EMPTY_QUERY.postedWithin).parse(q.postedWithin),
  };
}
