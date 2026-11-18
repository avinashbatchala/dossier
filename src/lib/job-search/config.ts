import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { env, type Env } from "@/lib/env";
import { BUILT_IN_PORTALS } from "@/lib/portals/built-in";
import { errorInfo, type PortalFields } from "@/lib/portals/engine";
import type { PortalConfig } from "@/lib/portals/format";
import { loadCatalog, type WithdrawnPortal } from "@/lib/portals/catalog";
import type { PortalUpdate } from "@/lib/portals/updates";
import { loadInstalledPortals, type InstalledPortal } from "@/lib/portals/installed";
import { decryptSecret, JOB_SOURCE_KEY, SecretUnreadable } from "@/lib/secrets";
import type { SettingsData } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import type { RequestContext } from "./adapter";
import { JobSearchError, jobSearchError } from "./errors";
import type { JobSource } from "./search";
import { ARBEITSAGENTUR_NOTE, FREEHIRE_URL, sourceInfo, type JobKeyState, type JobSearchSettingsView, type PortalView } from "./sources";

// Which portals to search, and with which fields (E22-3, #389): what's saved
// in Settings, or else the DOSSIER_JOBS_* variables. Any number of portals can
// be on. Each portal keeps its own fields, its secrets encrypted, so a key
// only ever goes to the portal it's for. Configs never name environment
// variables: the built-ins' are mapped here.

/** A portal as Settings saves it (setting `portals`); its secrets are in `portalKeysEnc`. */
type SavedPortal = { on: boolean; fields: Record<string, string>; acceptedAt: string | null };
export type SavedPortals = Record<string, SavedPortal>;
/** Each portal's secret fields, encrypted (JOB_SOURCE_KEY). */
export type SavedPortalKeys = Record<string, Record<string, string>>;

/** A portal in effect: what's saved, else from the environment, else the config's defaults. */
export type PortalSetup = {
  id: JobSource;
  config: PortalConfig;
  on: boolean;
  /** Text and choice fields' values. */
  fields: Record<string, string>;
  /** Secret fields: the value (server only, never sent to the browser) and where it's from. */
  keys: Record<string, { value: string | null; state: JobKeyState }>;
  /** When its note was accepted (the Bundesagentur's, #223); its searches wait until then. */
  acceptedAt: string | null;
  /** Whether this server offers it: DOSSIER_JOBS_ARBEITSAGENTUR=off turns the BA off. */
  offered: boolean;
  /** For a portal the user added (E23-3): where it came from and whether it was reviewed; null for a built-in. */
  installed: Pick<InstalledPortal, "origin" | "originUrl" | "reviewed"> | null;
  /**
   * When the catalog withdrew it (E23-5): why, and whether it's paused,
   * which it is, searched by nothing, until the user decides to keep it.
   */
  withdrawal: { reason: string; withdrawnAt: string; paused: boolean } | null;
};

export type JobSearchConfig = {
  /** Every portal: the built-ins in the order Settings lists them, then the ones the user added (E23-3). */
  portals: PortalSetup[];
  /** Whether a choice is saved in Settings, rather than coming from DOSSIER_JOBS_SOURCE. */
  saved: boolean;
  /** The FreeHire to search: freehire.me, or a self-hosted one (DOSSIER_FREEHIRE_URL). */
  freehire: { url: string };
};

type LegacyJobSettings = Pick<SettingsData, "jobSource" | "jsearchKeyEnc" | "jsearchHost" | "adzunaAppId" | "adzunaKeyEnc" | "arbeitsagenturAcceptedAt">;
type SavedJobSettings = LegacyJobSettings & Pick<SettingsData, "portals" | "portalKeysEnc"> & Partial<Pick<SettingsData, "portalWithdrawalsKept">>;
type JobEnv = Pick<
  Env,
  | "DOSSIER_JOBS_SOURCE"
  | "DOSSIER_JSEARCH_KEY"
  | "DOSSIER_JSEARCH_HOST"
  | "DOSSIER_ADZUNA_APP_ID"
  | "DOSSIER_ADZUNA_KEY"
  | "DOSSIER_FREEHIRE_URL"
  | "DOSSIER_JOBS_ARBEITSAGENTUR"
>;

const FROM_ENV: Record<NonNullable<Env["DOSSIER_JOBS_SOURCE"]>, JobSource | null> = {
  jsearch: "JSEARCH",
  adzuna: "ADZUNA",
  arbeitsagentur: "ARBEITSAGENTUR",
  freehire: "FREEHIRE",
  off: null,
};

/** The built-ins' environment variables, by field. Only here, never in a config, so a config can't read the server's secrets. */
const BUILT_IN_ENV: Partial<Record<JobSource, Record<string, keyof JobEnv>>> = {
  JSEARCH: { key: "DOSSIER_JSEARCH_KEY", host: "DOSSIER_JSEARCH_HOST" },
  ADZUNA: { appId: "DOSSIER_ADZUNA_APP_ID", key: "DOSSIER_ADZUNA_KEY" },
};

/**
 * The settings from before E22-3 (one chosen source, a key per source) in
 * the new shape, or null when nothing was saved. What `moveJobSettings`
 * writes once, and what's read until then.
 */
export function portalsFromLegacy(saved: LegacyJobSettings): { portals: SavedPortals; keys: SavedPortalKeys } | null {
  if (saved.jobSource === null && !saved.jsearchKeyEnc && !saved.adzunaKeyEnc && !saved.adzunaAppId && !saved.arbeitsagenturAcceptedAt) return null;
  const on = (id: JobSource) => saved.jobSource === id;
  return {
    portals: {
      JSEARCH: { on: on("JSEARCH"), fields: { host: saved.jsearchHost }, acceptedAt: null },
      ADZUNA: { on: on("ADZUNA"), fields: saved.adzunaAppId ? { appId: saved.adzunaAppId } : {}, acceptedAt: null },
      FREEHIRE: { on: on("FREEHIRE"), fields: {}, acceptedAt: null },
      ARBEITSAGENTUR: { on: on("ARBEITSAGENTUR"), fields: {}, acceptedAt: saved.arbeitsagenturAcceptedAt },
    },
    keys: {
      ...(saved.jsearchKeyEnc ? { JSEARCH: { key: saved.jsearchKeyEnc } } : {}),
      ...(saved.adzunaKeyEnc ? { ADZUNA: { key: saved.adzunaKeyEnc } } : {}),
    },
  };
}

/** The saved portals and keys, from either shape; null portals when nothing is saved. */
function savedPortals(saved: SavedJobSettings): { portals: SavedPortals | null; keys: SavedPortalKeys } {
  if (saved.portals !== null) return { portals: saved.portals, keys: saved.portalKeysEnc };
  // A key from the settings before E22-3 wins: after an import of an older file, that's the file's.
  const legacy = portalsFromLegacy(saved);
  return { portals: legacy?.portals ?? null, keys: { ...saved.portalKeysEnc, ...legacy?.keys } };
}

/** Every portal's secret fields as stored (encrypted), in either shape: for the export. */
export const savedPortalKeys = (saved: SavedJobSettings): SavedPortalKeys => savedPortals(saved).keys;

/** A saved key, decrypted, or else the environment's. */
function keyOf(stored: string | undefined, fromEnv: string | undefined, secret?: string): { value: string | null; state: JobKeyState } {
  if (stored) {
    try {
      return { value: decryptSecret(JOB_SOURCE_KEY, stored, secret), state: "set" };
    } catch (error) {
      if (!(error instanceof SecretUnreadable)) throw error;
      return { value: null, state: "unreadable" };
    }
  }
  return fromEnv ? { value: fromEnv, state: "env" } : { value: null, state: "none" };
}

export function resolveJobSearchConfig(
  saved: SavedJobSettings,
  source: JobEnv,
  secret?: string,
  installed: readonly InstalledPortal[] = [],
  withdrawn: readonly WithdrawnPortal[] = [],
): JobSearchConfig {
  const { portals, keys } = savedPortals(saved);
  const offered = source.DOSSIER_JOBS_ARBEITSAGENTUR !== "off";
  // Until something is saved, DOSSIER_JOBS_SOURCE says which portal is on.
  const fromEnv = portals === null && source.DOSSIER_JOBS_SOURCE ? FROM_ENV[source.DOSSIER_JOBS_SOURCE] : null;
  return {
    saved: portals !== null,
    freehire: { url: source.DOSSIER_FREEHIRE_URL ?? FREEHIRE_URL },
    portals: [
      // A built-in's update from the catalog (E23-5) replaces the bundled config.
      ...BUILT_IN_PORTALS.map((bundled) => ({ config: installed.find((portal) => portal.builtIn && portal.config.id === bundled.id)?.config ?? bundled, installed: null })),
      ...installed.filter((portal) => !portal.builtIn).map(({ config, ...from }) => ({ config, installed: from })),
    ].map(({ config, installed: from }) => {
      const id = config.id as JobSource;
      const state = portals?.[id];
      const envNames = BUILT_IN_ENV[id] ?? {};
      const envValue = (field: string) => (envNames[field] ? source[envNames[field]] : undefined);
      const setupKeys: PortalSetup["keys"] = {};
      for (const field of config.fields) if (field.type === "secret") setupKeys[field.name] = keyOf(keys[id]?.[field.name], envValue(field.name), secret);
      // An environment key goes with the environment's choices (DOSSIER_JSEARCH_HOST), when it names them.
      const keyFromEnv = Object.values(setupKeys).some((key) => key.state === "env");
      const fields: Record<string, string> = {};
      for (const field of config.fields) {
        if (field.type === "choice") {
          const chosen = keyFromEnv && envValue(field.name) ? envValue(field.name) : state?.fields[field.name];
          fields[field.name] = field.options.some((option) => option.value === chosen) ? chosen! : field.default;
        } else if (field.type === "text" || field.type === "list") fields[field.name] = state?.fields[field.name] ?? envValue(field.name) ?? "";
      }
      const isOn = state ? state.on : fromEnv === id;
      return {
        id,
        config,
        // A BA portal switched on before the server turned it off counts as off.
        on: isOn && (id !== "ARBEITSAGENTUR" || offered),
        fields,
        keys: setupKeys,
        acceptedAt: state?.acceptedAt ?? null,
        offered: id !== "ARBEITSAGENTUR" || offered,
        installed: from ? { origin: from.origin, originUrl: from.originUrl, reviewed: from.reviewed } : null,
        withdrawal: withdrawalOf(withdrawn.find((entry) => entry.id === id), saved.portalWithdrawalsKept ?? {}),
      };
    }),
  };
}

/** The job search configuration in effect right now. */
export async function loadJobSearchConfig(): Promise<JobSearchConfig> {
  const [settings, installed, catalog] = await Promise.all([loadSettings(), loadInstalledPortals(), loadCatalog()]);
  return resolveJobSearchConfig(settings, env, undefined, installed, catalog.withdrawn);
}

/** A withdrawal as a portal's setup has it: paused until the user keeps it, for this withdrawal. */
function withdrawalOf(entry: WithdrawnPortal | undefined, kept: Record<string, string>): PortalSetup["withdrawal"] {
  return entry ? { reason: entry.reason, withdrawnAt: entry.withdrawnAt, paused: kept[entry.id] !== entry.withdrawnAt } : null;
}

/** The portals switched on, in Settings order; one the catalog withdrew is paused until the user keeps it (E23-5). */
export const enabledPortals = (config: JobSearchConfig): JobSource[] => config.portals.filter((portal) => portal.on && !portal.withdrawal?.paused).map((portal) => portal.id);

/**
 * The portal the job agent searches until E22-8 (#394): the first one
 * switched on, but never the Bundesagentur für Arbeit, whose terms forbid
 * searching it on its own (#223).
 */
export const agentPortal = (config: JobSearchConfig): JobSource | null => config.portals.find((portal) => portal.on && portal.id !== "ARBEITSAGENTUR")?.id ?? null;

/** A portal's setup; undefined for an id that isn't a built-in. */
export const portalSetup = (config: JobSearchConfig, id: string): PortalSetup | undefined => config.portals.find((portal) => portal.id === id);

/**
 * For the server log at start (#223): the Bundesagentur für Arbeit's note,
 * when DOSSIER_JOBS_SOURCE chooses it rather than Settings; null otherwise.
 */
export function arbeitsagenturStartupNotice(config: JobSearchConfig): string | null {
  const ba = portalSetup(config, "ARBEITSAGENTUR");
  if (!ba?.on || config.saved) return null;
  const waiting = ba.acceptedAt ? "" : " It isn't searched until you tick “I understand” in Settings → Job search.";
  return `Job search: DOSSIER_JOBS_SOURCE chooses the Bundesagentur für Arbeit. ${ARBEITSAGENTUR_NOTE}${waiting}`;
}

const pickInfo = ({ name, description, tag, keyUrl, quotaPeriod, countries, kinds }: ReturnType<typeof sourceInfo>) => ({
  name,
  description,
  tag,
  keyUrl,
  quotaPeriod,
  countries: countries ? [...countries] : null,
  kinds: [...kinds],
});

/** What Settings → Job search shows: every portal, its fields and the keys' states, never the keys; and each one's update from the catalog (E23-5). */
export function jobSearchView(config: JobSearchConfig, updates: Readonly<Record<string, PortalUpdate>> = {}): JobSearchSettingsView {
  const portals: PortalView[] = config.portals
    .filter((portal) => portal.offered)
    .map((portal) => ({
      id: portal.id,
      // Plain values only: this goes to the browser, which can't take the credit link's pattern.
      ...pickInfo(sourceInfo(portal.id)),
      on: portal.on,
      installed: portal.installed ? { origin: portal.installed.origin, reviewed: portal.installed.reviewed, termsUrl: portal.config.termsUrl ?? null } : null,
      version: portal.config.version,
      withdrawal: portal.withdrawal,
      update: updates[portal.id] ?? null,
      acceptedAt: portal.acceptedAt,
      consent: portal.config.consent?.note ?? null,
      fields: portal.config.fields
        .filter((field) => field.type !== "server")
        .map((field) =>
          field.type === "secret"
            ? { name: field.name, label: field.label, type: "secret" as const, keyState: portal.keys[field.name].state, envName: BUILT_IN_ENV[portal.id]?.[field.name] ?? null }
            : field.type === "choice"
              ? { name: field.name, label: field.label, type: "choice" as const, value: portal.fields[field.name], options: field.options.map(({ value, label }) => ({ value, label })) }
              : field.type === "list"
                ? { name: field.name, label: field.label, type: "list" as const, value: portal.fields[field.name] ?? "", max: field.max, help: field.help ?? null }
                : { name: field.name, label: field.label, type: "text" as const, value: portal.fields[field.name] ?? "" },
        ),
    }));
  return { portals, freehire: { host: new URL(config.freehire.url).host } };
}

/**
 * Where a source's requests go: its own address, unless the end-to-end
 * tests point every source at their fake one (DOSSIER_JOBS_TEST_BASE_URL),
 * or FreeHire is pointed at a self-hosted origin (DOSSIER_FREEHIRE_URL).
 */
export function requestContext(source: JobSource, base = env.DOSSIER_JOBS_TEST_BASE_URL, freehireUrl = env.DOSSIER_FREEHIRE_URL): RequestContext {
  if (base) return { baseUrl: `${base.replace(/\/+$/, "")}/${source.toLowerCase()}` };
  if (source === "FREEHIRE" && freehireUrl) return { baseUrl: freehireUrl };
  return {};
}

/**
 * The fields a portal needs, keys included, or a JobSearchError saying
 * what's missing. Every request to a portal asks here first, so the BA's
 * switch and note (#223) hold for Find jobs, saved postings, the job agent
 * and the Claude connector.
 */
export function credentialsFor(config: JobSearchConfig, source: JobSource): PortalFields {
  const portal = portalSetup(config, source);
  if (!portal || !portal.offered) throw jobSearchError("off", source);
  if (portal.withdrawal?.paused) throw new JobSearchError("off", `${sourceInfo(source).name} is paused: the catalog withdrew it. Look at it in Settings → Job search.`);
  if (portal.config.consent && !portal.acceptedAt) throw jobSearchError("not-accepted", source);
  const fields: Record<string, string> = { ...portal.fields };
  for (const field of portal.config.fields) {
    if (field.type === "secret") {
      const key = portal.keys[field.name];
      if (key.value) fields[field.name] = key.value;
      else if (field.required) {
        throw key.state === "unreadable"
          ? new JobSearchError("no-key", `Your saved ${sourceInfo(source).name} key can't be read. Enter it again in Settings → Job search.`)
          : jobSearchError("no-key", source);
      }
    } else if (field.type === "text" && field.required && !fields[field.name]) throw jobSearchError("no-key", source);
    // "Add your Greenhouse boards…": named from the field.
    else if (field.type === "list" && field.required && !fields[field.name]) throw jobSearchError("no-key", source, { info: errorInfo(portal.config) });
  }
  return fields;
}

/**
 * Saves the portals, the first time moving everything from the settings
 * before E22-3 and clearing those, so it happens once. `change` gets the
 * portals and keys as they stand and returns them changed.
 */
export async function savePortals(
  change: (current: { portals: SavedPortals; keys: SavedPortalKeys }) => { portals: SavedPortals; keys: SavedPortalKeys },
  db?: Prisma.TransactionClient,
): Promise<void> {
  const saved = await loadSettings(db);
  const effective = resolveJobSearchConfig(saved, env);
  const { portals, keys } = savedPortals(saved);
  // What's in effect from the environment becomes what's saved, as a saved choice did before.
  const current: SavedPortals = portals ?? Object.fromEntries(effective.portals.map((portal) => [portal.id, { on: portal.on, fields: {}, acceptedAt: null }]));
  const next = change({ portals: current, keys });
  await saveSettings(
      { portals: next.portals, portalKeysEnc: next.keys, jobSource: null, jsearchKeyEnc: null, adzunaAppId: null, adzunaKeyEnc: null, arbeitsagenturAcceptedAt: null },
      db,
    );
}

/** Moves the settings from before E22-3 into the portals' shape, once; nothing when there's nothing to move. */
export async function moveJobSettings(db?: Prisma.TransactionClient): Promise<boolean> {
  const saved = await loadSettings(db);
  if (saved.portals !== null || !portalsFromLegacy(saved)) return false;
  await savePortals((current) => current, db);
  return true;
}
