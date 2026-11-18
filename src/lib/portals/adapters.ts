import "server-only";

import { BUILT_IN_PORTALS } from "./built-in";
import { portalAdapter, type PortalAdapter } from "./engine";
import { builtInUpdate, installedPortal } from "./installed";

// The engine's adapter for each portal (E22-2): the built-ins', made once,
// and each installed portal's, made again when its version changes (E23-3).
// An installed portal's hosts are reached only on the public internet.

const ADAPTERS = new Map(BUILT_IN_PORTALS.map((config) => [config.id, portalAdapter(config)]));
const INSTALLED = new Map<string, { version: string; adapter: PortalAdapter }>();

/** A built-in portal's adapter; throws for an id that isn't one, which callers check first (isJobSource). */
export function builtInAdapter(id: string): PortalAdapter {
  const adapter = ADAPTERS.get(id);
  if (!adapter) throw new Error(`No built-in portal ${id}.`);
  return adapter;
}

/** Any portal's adapter, a built-in or an installed one (as last read); undefined for an id that's neither. */
export function adapterFor(id: string): PortalAdapter | undefined {
  // A built-in's update from the catalog (E23-5) runs instead of the bundled one.
  const config = builtInUpdate(id) ?? (ADAPTERS.has(id) ? undefined : installedPortal(id));
  if (!config) return ADAPTERS.get(id);
  const made = INSTALLED.get(id);
  if (made?.version === config.version) return made.adapter;
  const adapter = portalAdapter(config, { guarded: true });
  INSTALLED.set(id, { version: config.version, adapter });
  return adapter;
}

/** A portal's version, for caches that must not outlive an update. */
export const portalVersion = (id: string): string => builtInUpdate(id)?.version ?? BUILT_IN_PORTALS.find((config) => config.id === id)?.version ?? installedPortal(id)?.version ?? "";
