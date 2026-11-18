import "server-only";

import { countryName } from "@/lib/job-search/countries";

import type { JobSearchConfig } from "@/lib/job-search/config";

import { loadCatalog, type CatalogEntry } from "./catalog";
import type { PortalConfig } from "./format";
import { newerVersion } from "./version";

// Portal updates (E23-5, #401): an installed portal, or a built-in, stays as
// it is until the user installs the newer version the catalog lists. This
// says what changed; a version that reaches a new host needs the user's
// approval of it.

export type PortalUpdate = {
  from: string;
  to: string;
  /** Hosts it would reach that the installed version doesn't: the user approves each. */
  newHosts: string[];
  /** What else changed, in words. */
  changes: string[];
};

const listed = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

/** The update the catalog has for a portal, or null when it has none newer. */
export function updateFor(current: PortalConfig, entry: CatalogEntry | undefined): PortalUpdate | null {
  if (!entry || !newerVersion(entry.version, current.version)) return null;
  const next = entry.config;
  const changes: string[] = [];
  if (next.name !== current.name) changes.push(`Renamed to ${next.name}.`);
  const newHosts = next.hosts.filter((host) => !current.hosts.includes(host));
  const goneHosts = current.hosts.filter((host) => !next.hosts.includes(host));
  if (goneHosts.length > 0) changes.push(`No longer reaches ${listed(goneHosts)}.`);
  if (current.countries !== null && next.countries === null) changes.push("Now covers every country.");
  else if (next.countries !== null) {
    const added = next.countries.filter((code) => current.countries !== null && !current.countries.includes(code));
    const dropped = (current.countries ?? []).filter((code) => !next.countries!.includes(code));
    if (added.length > 0) changes.push(`Adds ${listed(added.map(countryName))}.`);
    if (dropped.length > 0 || current.countries === null) changes.push(current.countries === null ? `Now covers only ${listed(next.countries.map(countryName))}.` : `No longer covers ${listed(dropped.map(countryName))}.`);
  }
  const labels = (config: PortalConfig) => config.fields.filter((field) => field.type !== "server").map((field) => field.label);
  const asks = labels(next).filter((label) => !labels(current).includes(label));
  const stops = labels(current).filter((label) => !labels(next).includes(label));
  if (asks.length > 0) changes.push(`Asks for ${listed(asks)}.`);
  if (stops.length > 0) changes.push(`No longer asks for ${listed(stops)}.`);
  if (changes.length === 0 && newHosts.length === 0) changes.push("Changes how it asks for postings or reads them.");
  return { from: current.version, to: next.version, newHosts, changes };
}

/** Each portal's update from the catalog, by id; none for a withdrawn one. */
export async function portalUpdates(config: JobSearchConfig): Promise<Record<string, PortalUpdate>> {
  const { portals } = await loadCatalog();
  return Object.fromEntries(
    config.portals.flatMap((portal) => {
      const update = portal.withdrawal ? null : updateFor(portal.config, portals.find((entry) => entry.id === portal.id));
      return update ? [[portal.id, update]] : [];
    }),
  );
}
