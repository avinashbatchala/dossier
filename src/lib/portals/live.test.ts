import { describe, expect, it } from "vitest";

import { EMPTY_QUERY, foundPostingSchema, type SearchQuery } from "@/lib/job-search/search";

// Checks portals against the real services (E22-10), skipped unless asked
// for. JOBS_LIVE names the portals by id, any case, comma-separated:
//
//   docker compose exec -e JOBS_LIVE=freehire app yarn vitest run src/lib/portals/live.test.ts
//   docker compose exec -e JOBS_LIVE=jsearch,adzuna app yarn vitest run src/lib/portals/live.test.ts
//
// Each uses what the app would: the fields and key saved in Settings → Job
// search, or the built-ins' DOSSIER_* variables, read from the database and
// `.env` as the app reads them. Nothing is saved. Each run sends a search, the
// next page when there is one, the details of a posting that has only its
// start, and the connection test: a portal with a plan spends those.

const asked = (process.env.JOBS_LIVE ?? "")
  .split(",")
  .map((id) => id.trim().toUpperCase())
  .filter(Boolean);

/** A search the portal covers: software developers in Germany, or in the first country it lists. */
function queryFor(countries: readonly string[] | null): SearchQuery {
  const country = countries === null || countries.includes("de") ? "de" : countries[0];
  return { ...EMPTY_QUERY, keywords: "software developer", country };
}

describe.runIf(asked.length > 0)("portals (live)", () => {
  it.each(asked)("%s: a search, its next page, a posting's whole text and the connection test", { timeout: 300_000 }, async (id) => {
    // `.env` as the app reads it: DOSSIER_SECRET decrypts a saved key, and DOSSIER_* variables count.
    process.loadEnvFile(".env");
    const [{ credentialsFor, enabledPortals, loadJobSearchConfig, requestContext }, { isJobSource, sourceInfo }, { builtInAdapter }] = await Promise.all([
      import("@/lib/job-search/config"),
      import("@/lib/job-search/sources"),
      import("./adapters"),
    ]);
    if (!isJobSource(id)) throw new Error(`${id} isn't an installed portal.`);
    const config = await loadJobSearchConfig();
    if (!enabledPortals(config).includes(id)) console.info(`${id} isn't switched on in Settings → Job search; checking it with what's saved.`);
    // Throws, saying so, when its key isn't saved.
    const fields = credentialsFor(config, id);
    const context = requestContext(id);
    const portal = builtInAdapter(id);
    const query = queryFor(sourceInfo(id).countries);

    const page = await portal.search(query, fields, null, context);
    expect(page.postings.length, "postings found").toBeGreaterThan(0);
    for (const posting of page.postings) {
      expect(foundPostingSchema.safeParse(posting).success, `${posting.externalId} in the shared shape`).toBe(true);
      expect(posting.title).not.toBe("");
    }
    if (page.next) expect((await portal.search(query, fields, page.next, context)).postings.length, "postings on the next page").toBeGreaterThan(0);

    const partial = page.postings.find((posting) => !posting.complete);
    if (partial) {
      const text = await portal.details(partial, fields, context);
      // Some portals can't give more than the start; when one does, it's the whole posting.
      if (text !== null) expect(text.length).toBeGreaterThan(partial.description.length);
    }
    await expect(portal.test(fields, context)).resolves.toBeUndefined();
  });
});
