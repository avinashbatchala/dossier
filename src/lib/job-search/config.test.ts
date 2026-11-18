import { describe, expect, it, vi } from "vitest";

import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";

import {
  agentPortal,
  arbeitsagenturStartupNotice,
  credentialsFor,
  enabledPortals,
  jobSearchView,
  portalSetup,
  portalsFromLegacy,
  requestContext,
  resolveJobSearchConfig,
} from "./config";
import { JobSearchError } from "./errors";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));

const nothingSaved = {
  portals: null,
  portalKeysEnc: {},
  jobSource: null,
  jsearchKeyEnc: null,
  jsearchHost: "openwebninja" as const,
  adzunaAppId: null,
  adzunaKeyEnc: null,
  arbeitsagenturAcceptedAt: null,
};
const ACCEPTED = "2026-10-23T09:00:00.000Z";
const noEnv = {};
const off = { on: false, fields: {}, acceptedAt: null };
const saved = (portals: Record<string, { on: boolean; fields?: Record<string, string>; acceptedAt?: string | null }>, keys: Record<string, Record<string, string>> = {}) => ({
  ...nothingSaved,
  portals: Object.fromEntries(Object.entries(portals).map(([id, portal]) => [id, { ...off, ...portal }])),
  portalKeysEnc: keys,
});
const problem = (work: () => unknown) => {
  try {
    work();
  } catch (error) {
    return error instanceof JobSearchError ? [error.problem, error.message] : error;
  }
  return null;
};

describe("resolveJobSearchConfig", () => {
  it("has every portal off until one is switched on", () => {
    const config = resolveJobSearchConfig(nothingSaved, noEnv);
    expect(config.saved).toBe(false);
    expect(enabledPortals(config)).toEqual([]);
    expect(jobSearchView(config).portals.map((portal) => [portal.id, portal.on])).toEqual([
      ["JSEARCH", false],
      ["ADZUNA", false],
      ["FREEHIRE", false],
      ["ARBEITSAGENTUR", false],
    ]);
  });

  it("uses the environment until something is saved", () => {
    const config = resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "adzuna", DOSSIER_ADZUNA_APP_ID: "app-env", DOSSIER_ADZUNA_KEY: "key-env" });
    expect(enabledPortals(config)).toEqual(["ADZUNA"]);
    expect(portalSetup(config, "ADZUNA")).toMatchObject({ fields: { appId: "app-env" }, keys: { key: { value: "key-env", state: "env" } } });
    expect(resolveJobSearchConfig(saved({ JSEARCH: { on: true } }), { DOSSIER_JOBS_SOURCE: "adzuna" }).portals.filter((portal) => portal.on).map((portal) => portal.id)).toEqual(["JSEARCH"]);
  });

  it("switches on any number of portals, each with its own fields and keys, decrypted", () => {
    const config = resolveJobSearchConfig(
      saved({ JSEARCH: { on: true, fields: { host: "rapidapi" } }, FREEHIRE: { on: true }, ADZUNA: { on: false, fields: { appId: "app-1" } } }, { JSEARCH: { key: encryptSecret(JOB_SOURCE_KEY, "js-key") } }),
      noEnv,
    );
    expect(enabledPortals(config)).toEqual(["JSEARCH", "FREEHIRE"]);
    expect(credentialsFor(config, "JSEARCH")).toEqual({ host: "rapidapi", key: "js-key" });
    expect(credentialsFor(config, "FREEHIRE")).toEqual({});
    // The view says a key is there, never what it is, and holds only plain values (it goes to the browser).
    expect(JSON.parse(JSON.stringify(jobSearchView(config)))).toEqual(jobSearchView(config));
    const view = JSON.stringify(jobSearchView(config));
    expect(view).not.toContain("js-key");
    expect(jobSearchView(config).portals[0].fields).toEqual([
      { name: "key", label: "API key", type: "secret", keyState: "set", envName: "DOSSIER_JSEARCH_KEY" },
      { name: "host", label: "Key from", type: "choice", value: "rapidapi", options: [{ value: "openwebninja", label: "OpenWeb Ninja" }, { value: "rapidapi", label: "RapidAPI" }] },
    ]);
  });

  it("takes an environment key with the environment's host, and refuses a choice that isn't an option", () => {
    const fromEnv = resolveJobSearchConfig(saved({ JSEARCH: { on: true, fields: { host: "openwebninja" } } }), { DOSSIER_JSEARCH_KEY: "env-key", DOSSIER_JSEARCH_HOST: "rapidapi" });
    expect(credentialsFor(fromEnv, "JSEARCH")).toEqual({ host: "rapidapi", key: "env-key" });
    const odd = resolveJobSearchConfig(saved({ JSEARCH: { on: true, fields: { host: "elsewhere" } } }), { DOSSIER_JSEARCH_KEY: "k" });
    expect(credentialsFor(odd, "JSEARCH").host).toBe("openwebninja");
  });

  it("says when a saved key can't be read, rather than using another", () => {
    const config = resolveJobSearchConfig(saved({ ADZUNA: { on: true, fields: { appId: "a" } } }, { ADZUNA: { key: "not-decryptable" } }), { DOSSIER_ADZUNA_KEY: "env-key" });
    expect(portalSetup(config, "ADZUNA")!.keys.key.state).toBe("unreadable");
    expect(problem(() => credentialsFor(config, "ADZUNA"))).toEqual(["no-key", expect.stringContaining("can't be read")]);
  });

  it("says what's missing", () => {
    const config = resolveJobSearchConfig(saved({ JSEARCH: { on: true }, ADZUNA: { on: true, fields: { appId: "a" } } }), noEnv);
    expect(problem(() => credentialsFor(config, "JSEARCH"))).toEqual(["no-key", "Add your JSearch key in Settings → Job search first."]);
    expect(problem(() => credentialsFor(config, "ADZUNA"))).toEqual(["no-key", "Add your Adzuna app ID and key in Settings → Job search first."]);
  });
});

describe("the settings from before E22-3", () => {
  const legacy = { ...nothingSaved, jobSource: "ADZUNA" as const, adzunaAppId: "app-1", adzunaKeyEnc: encryptSecret(JOB_SOURCE_KEY, "az-key"), jsearchKeyEnc: encryptSecret(JOB_SOURCE_KEY, "js-key"), jsearchHost: "rapidapi" as const };

  it("read as portals: the chosen source on, its fields and every key kept", () => {
    const config = resolveJobSearchConfig(legacy, noEnv);
    expect(config.saved).toBe(true);
    expect(enabledPortals(config)).toEqual(["ADZUNA"]);
    expect(credentialsFor(config, "ADZUNA")).toEqual({ appId: "app-1", key: "az-key" });
    expect(portalSetup(config, "JSEARCH")).toMatchObject({ on: false, fields: { host: "rapidapi" }, keys: { key: { value: "js-key" } } });
  });

  it("move as they are, keys still encrypted; nothing saved moves nothing", () => {
    const moved = portalsFromLegacy(legacy)!;
    expect(moved.portals.ADZUNA).toEqual({ on: true, fields: { appId: "app-1" }, acceptedAt: null });
    expect(moved.keys).toEqual({ JSEARCH: { key: legacy.jsearchKeyEnc }, ADZUNA: { key: legacy.adzunaKeyEnc } });
    expect(portalsFromLegacy(nothingSaved)).toBeNull();
    expect(portalsFromLegacy({ ...nothingSaved, jobSource: "OFF" })!.portals.JSEARCH.on).toBe(false);
  });
});

describe("the Bundesagentur für Arbeit (#223)", () => {
  it("isn't searched until its note is accepted", () => {
    const waiting = resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "arbeitsagentur" });
    expect(problem(() => credentialsFor(waiting, "ARBEITSAGENTUR"))).toEqual(["not-accepted", expect.any(String)]);
    const accepted = resolveJobSearchConfig(saved({ ARBEITSAGENTUR: { on: true, acceptedAt: ACCEPTED } }), noEnv);
    expect(credentialsFor(accepted, "ARBEITSAGENTUR")).toEqual({});
  });

  it("is off everywhere when the server turns it off, one switched on included", () => {
    const config = resolveJobSearchConfig(saved({ ARBEITSAGENTUR: { on: true, acceptedAt: ACCEPTED } }), { DOSSIER_JOBS_ARBEITSAGENTUR: "off" });
    expect(enabledPortals(config)).toEqual([]);
    expect(jobSearchView(config).portals.map((portal) => portal.id)).not.toContain("ARBEITSAGENTUR");
    expect(problem(() => credentialsFor(config, "ARBEITSAGENTUR"))).toEqual(["off", expect.any(String)]);
  });

  it("is never what the job agent searches", () => {
    expect(agentPortal(resolveJobSearchConfig(saved({ ARBEITSAGENTUR: { on: true, acceptedAt: ACCEPTED } }), noEnv))).toBeNull();
    expect(agentPortal(resolveJobSearchConfig(saved({ ARBEITSAGENTUR: { on: true, acceptedAt: ACCEPTED }, FREEHIRE: { on: true } }), noEnv))).toBe("FREEHIRE");
  });

  it("logs its note at start when DOSSIER_JOBS_SOURCE chooses it", () => {
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "arbeitsagentur" }))).toMatch(/^Job search: DOSSIER_JOBS_SOURCE chooses the Bundesagentur für Arbeit\. .*I understand/);
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(saved({ ARBEITSAGENTUR: { on: true, acceptedAt: ACCEPTED } }), noEnv))).toBeNull();
    expect(arbeitsagenturStartupNotice(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "jsearch" }))).toBeNull();
  });
});

describe("requestContext", () => {
  it("leaves sources at their own address, unless the end-to-end tests point them at a fake", () => {
    expect(requestContext("JSEARCH", undefined, undefined)).toEqual({});
    expect(requestContext("ADZUNA", "http://localhost:3101/", undefined)).toEqual({ baseUrl: "http://localhost:3101/adzuna" });
    expect(requestContext("FREEHIRE", undefined, "https://jobs.example.org")).toEqual({ baseUrl: "https://jobs.example.org" });
  });
});

describe("FreeHire from the environment", () => {
  it("is switched on when DOSSIER_JOBS_SOURCE says so, and searches freehire.me or the self-hosted one", () => {
    expect(enabledPortals(resolveJobSearchConfig(nothingSaved, { DOSSIER_JOBS_SOURCE: "freehire" }))).toEqual(["FREEHIRE"]);
    expect(jobSearchView(resolveJobSearchConfig(nothingSaved, noEnv)).freehire).toEqual({ host: "freehire.me" });
    expect(jobSearchView(resolveJobSearchConfig(nothingSaved, { DOSSIER_FREEHIRE_URL: "https://jobs.example.org" })).freehire).toEqual({ host: "jobs.example.org" });
  });
});
