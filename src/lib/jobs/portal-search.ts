import "server-only";

import { z } from "zod";

import { portalsLine, sourceIdSchema } from "@/lib/job-search/search";
import { runPortals } from "@/lib/posting-searches";

import { defineJob } from "./runner";

// A search across the portals switched on (E22-4, #390), in the background:
// the page shows each portal as it answers, and leaving it doesn't stop the
// search. It asks no AI provider, so it runs beside the AI jobs.

export const searchJobKey = (searchId: string) => `search:${searchId}`;

export const portalSearchJob = defineJob({
  type: "portal-search",
  beside: true,
  input: z.object({
    searchId: z.string().min(1),
    /** The portals to ask; all of them for a new search, one for Try again. */
    portals: z.array(sourceIdSchema).min(1),
    /** Show more: ask each for its next page. */
    more: z.boolean().default(false),
  }),
  result: z.object({ found: z.number().int() }),
  async run({ searchId, portals, more }, { step, signal }) {
    const found = await runPortals(searchId, portals, { more, signal, onChange: (state) => step(portalsLine(state)) });
    return { found };
  },
});
