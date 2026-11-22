import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { credentialsFor, enabledPortals, loadJobSearchConfig } from "@/lib/job-search/config";
import { sourceInfo } from "@/lib/job-search/sources";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { BUILT_IN_PORTALS } from "./built-in";
import { catalogView, isReviewed, loadCatalog, parseCatalog, readCatalog } from "./catalog";
import { portalConfigSchema } from "./format";
import { builtInUpdate, installPortal, loadInstalledPortals } from "./installed";
import { jsonSample } from "./samples.test-data";
import { portalUpdates, updateFor } from "./updates";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
const sent = vi.hoisted(() => ({ events: [] as { name: string; data: unknown }[] }));
vi.mock("@/lib/notifications/notify", () => ({
  emit: vi.fn(async (name: string, data: unknown) => {
    sent.events.push({ name, data });
    return 1;
  }),
}));
const prisma = () => db.client!;

const now = new Date("2026-11-16T10:00:00Z");
const sample = { ...jsonSample, termsUrl: "https://sample.example/terms" };
const entry = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: config.id,
  version: config.version,
  name: config.name,
  description: config.description,
  countries: config.countries,
  kinds: config.kinds,
  access: "official-api",
  needsKey: true,
  builtIn: false,
  termsUrl: "https://sample.example/terms",
  config,
  ...extra,
});
const jsearch = BUILT_IN_PORTALS.find((config) => config.id === "JSEARCH")!;

/** A fake backend: the catalog, with an ETag, or an error. */
function backend(body: unknown, { etag = '"v1"', status = 200 } = {}) {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    requests.push({ url, headers });
    if (status !== 200) return new Response("", { status });
    if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { "cache-control": "public, max-age=86400" } });
    return new Response(JSON.stringify(body), { headers: { etag, "cache-control": "public, max-age=86400" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

beforeEach(async () => {
  await resetDatabase(prisma());
  await loadInstalledPortals();
});
afterAll(() => prisma().$disconnect());

describe("the portal catalog (E23-2)", () => {
  it("leaves out an entry that doesn't fit, or whose config this Dossier can't read", () => {
    const parsed = parseCatalog({
      portals: [entry(sample), { ...entry(sample), id: "OTHER" }, { id: "HALF" }, entry({ ...sample, id: "NEWER", format: 2 })],
      withdrawn: [{ id: "GONE", reason: "Broken.", withdrawnAt: "2026-11-16T09:00:00Z" }, { id: 1 }],
      commit: "abc",
      extra: true,
    });
    expect(parsed?.portals.map((portal) => portal.id)).toEqual(["SAMPLE_JSON"]);
    expect(parsed?.withdrawn).toEqual([{ id: "GONE", reason: "Broken.", withdrawnAt: "2026-11-16T09:00:00Z" }]);
    expect(parseCatalog({ nope: [] })).toBeNull();
  });

  it("is read anonymously, with its ETag, at most once a day, and kept when the backend fails", async () => {
    const { fetchImpl, requests } = backend({ portals: [entry(sample)], withdrawn: [], commit: "abc" });
    expect(await readCatalog({ now, fetchImpl, base: "https://api.example/v1", force: true })).toBe("read");
    expect(requests[0]).toEqual({ url: "https://api.example/v1/portals", headers: { accept: "application/json", "user-agent": "Dossier" } });
    expect((await loadCatalog()).portals.map((portal) => portal.id)).toEqual(["SAMPLE_JSON"]);
    // Not due again for a day; Browse portals asks again, sending the ETag.
    const later = new Date(now.getTime() + 3_600_000);
    expect(await readCatalog({ now: later, fetchImpl, base: "https://api.example/v1" })).toBe("skipped");
    expect(await readCatalog({ now: later, fetchImpl, base: "https://api.example/v1", force: true })).toBe("same");
    expect(requests.at(-1)?.headers["if-none-match"]).toBe('"v1"');
    // Opened twice in a minute: asked once.
    expect(await readCatalog({ now: new Date(later.getTime() + 10_000), fetchImpl, base: "https://api.example/v1", force: true })).toBe("skipped");
    const down = backend(null, { status: 503 });
    expect(await readCatalog({ now: new Date(now.getTime() + 2 * 86_400_000), fetchImpl: down.fetchImpl, base: "https://api.example/v1", force: true })).toBe("failed");
    expect((await loadCatalog()).portals).toHaveLength(1);
  });

  it("marks a config exactly as reviewed as reviewed, and says where each entry stands here", async () => {
    await readCatalog({ now, fetchImpl: backend({ portals: [entry(sample), entry(jsearch, { builtIn: true })], withdrawn: [] }).fetchImpl, base: "https://x/v1", force: true });
    const config = portalConfigSchema.parse(sample);
    expect(await isReviewed(config)).toBe(true);
    expect(await isReviewed({ ...config, hosts: ["api.sample.example", "evil.example"] })).toBe(false);
    const view = await catalogView(new Map([["SAMPLE_JSON", "1.0.0"]]), new Set(["JSEARCH"]));
    expect(view.portals.map((portal) => [portal.id, portal.state])).toEqual([
      ["SAMPLE_JSON", "added"],
      ["JSEARCH", "built-in"],
    ]);
    expect(view.portals[0]).toMatchObject({ hosts: ["api.sample.example"], asks: ["API key"], access: "official-api", needsKey: true });
  });
});

describe("updates and withdrawals (E23-5)", () => {
  it("says what a newer version changes, and which new hosts need approving", () => {
    const current = portalConfigSchema.parse(sample);
    const next = portalConfigSchema.parse({
      ...sample,
      version: "1.1.0",
      hosts: ["api.sample.example", "cdn.sample.example"],
      countries: ["de", "at", "ch"],
      fields: [...sample.fields, { name: "region", type: "text", label: "Region" }],
    });
    expect(updateFor(current, { ...entry(next), config: next } as never)).toEqual({
      from: "1.0.0",
      to: "1.1.0",
      newHosts: ["cdn.sample.example"],
      changes: ["Adds Switzerland.", "Asks for Region."],
    });
    expect(updateFor(current, { ...entry(current), config: current } as never)).toBeNull();
  });

  it("updates a built-in from the catalog until a release bundles that version", async () => {
    const newer = portalConfigSchema.parse({ ...jsearch, version: "9.0.0", name: "JSearch, newer" });
    await readCatalog({ now, fetchImpl: backend({ portals: [entry(newer, { builtIn: true })], withdrawn: [] }).fetchImpl, base: "https://x/v1", force: true });
    const before = await loadJobSearchConfig();
    expect(await portalUpdates(before)).toEqual({ JSEARCH: expect.objectContaining({ from: jsearch.version, to: "9.0.0", newHosts: [] }) });
    await installPortal(newer, { origin: "catalog", reviewed: true });
    expect(builtInUpdate("JSEARCH")?.version).toBe("9.0.0");
    expect(sourceInfo("JSEARCH").name).toBe("JSearch, newer");
    const after = await loadJobSearchConfig();
    expect(after.portals.find((portal) => portal.id === "JSEARCH")).toMatchObject({ config: { version: "9.0.0" }, installed: null });
    expect(after.portals.filter((portal) => portal.id === "JSEARCH")).toHaveLength(1);
    expect(await portalUpdates(after)).toEqual({});
    // An older or equal version than the bundled one isn't used.
    await prisma().installedPortal.update({ where: { id: "JSEARCH" }, data: { config: { ...jsearch, version: "0.1.0" } as never, version: "0.1.0" } });
    await loadInstalledPortals();
    expect(builtInUpdate("JSEARCH")).toBeUndefined();
  });

  it("pauses a withdrawn portal until the user keeps it, for that withdrawal", async () => {
    await saveSettings({ portals: { FREEHIRE: { on: true, fields: {}, acceptedAt: null } } });
    const withdrawal = { id: "FREEHIRE", reason: "Its terms changed.", withdrawnAt: "2026-11-16T09:00:00Z" };
    await readCatalog({ now, fetchImpl: backend({ portals: [], withdrawn: [withdrawal] }).fetchImpl, base: "https://x/v1", force: true });
    const paused = await loadJobSearchConfig();
    expect(paused.portals.find((portal) => portal.id === "FREEHIRE")?.withdrawal).toEqual({ reason: "Its terms changed.", withdrawnAt: "2026-11-16T09:00:00Z", paused: true });
    expect(enabledPortals(paused)).toEqual([]);
    expect(() => credentialsFor(paused, "FREEHIRE")).toThrow("FreeHire is paused: the catalog withdrew it.");

    await saveSettings({ portalWithdrawalsKept: { FREEHIRE: "2026-11-16T09:00:00Z" } });
    expect(enabledPortals(await loadJobSearchConfig())).toEqual(["FREEHIRE"]);
    // Withdrawn again later: paused again.
    await readCatalog({ now: new Date(now.getTime() + 86_400_000 * 2), fetchImpl: backend({ portals: [], withdrawn: [{ ...withdrawal, withdrawnAt: "2026-11-17T09:00:00Z" }] }, { etag: '"v2"' }).fetchImpl, base: "https://x/v1", force: true });
    expect(enabledPortals(await loadJobSearchConfig())).toEqual([]);
  });
});

describe("notifications about the portals in use (E26-5)", () => {
  it("say once that a portal was withdrawn and is paused, and once per version that it has an update", async () => {
    const { notifyPortalChanges } = await import("./notices");
    sent.events = [];
    await saveSettings({ portals: { FREEHIRE: { on: true, fields: {}, acceptedAt: null }, JSEARCH: { on: true, fields: {}, acceptedAt: null }, ADZUNA: { on: false, fields: {}, acceptedAt: null } } });
    const newer = portalConfigSchema.parse({ ...jsearch, version: "9.0.0", hosts: [...jsearch.hosts, "new.example"] });
    const adzuna = BUILT_IN_PORTALS.find((config) => config.id === "ADZUNA")!;
    const withdrawal = { id: "FREEHIRE", reason: "Its terms changed.", withdrawnAt: "2026-11-16T09:00:00Z" };
    await readCatalog({
      now,
      fetchImpl: backend({ portals: [entry(newer, { builtIn: true }), entry(portalConfigSchema.parse({ ...adzuna, version: "9.0.0" }), { builtIn: true })], withdrawn: [withdrawal] }).fetchImpl,
      base: "https://x/v1",
      force: true,
    });
    expect(await notifyPortalChanges(now)).toBe(2);
    // Adzuna isn't in use: nothing about it.
    expect(sent.events).toEqual([
      { name: "portal.updated", data: { portal: "JSearch", changes: [`Version ${jsearch.version} to 9.0.0.`], newHosts: ["new.example"] } },
      { name: "portal.withdrawn", data: { portal: "FreeHire", why: "Its terms changed." } },
    ]);
    // Said once.
    expect(await notifyPortalChanges(now)).toBe(0);
    expect(sent.events).toHaveLength(2);
  });
});
