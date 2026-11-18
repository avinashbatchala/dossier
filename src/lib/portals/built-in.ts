import { portalConfigSchema, type PortalConfig } from "./format";
import adzuna from "./built-in/adzuna.json";
import arbeitsagentur from "./built-in/arbeitsagentur.json";
import freehire from "./built-in/freehire.json";
import jsearch from "./built-in/jsearch.json";

// The portals that come with Dossier (E22-2, #388): JSearch, Adzuna, FreeHire
// and the Bundesagentur für Arbeit, as configs in the same format as any
// other portal, in the order Settings lists them. This is the snapshot a
// release bundles (`yarn portals-snapshot`); the public dossier-portals
// repository is their one source (E23-1, S4a), and newer versions reach
// installs through the catalog between releases. Their environment variables
// are mapped in code, in src/lib/job-search/config.ts, never in the configs.

export const BUILT_IN_PORTALS: readonly PortalConfig[] = [jsearch, adzuna, freehire, arbeitsagentur].map((config) => portalConfigSchema.parse(config));

const BY_ID = new Map(BUILT_IN_PORTALS.map((config) => [config.id, config]));

/** A built-in portal's config, or undefined for any other id. */
export function builtInPortal(id: string): PortalConfig | undefined {
  return BY_ID.get(id);
}
