import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";
import { searchPostings } from "@/lib/job-search";
import { credentialsFor, loadJobSearchConfig } from "@/lib/job-search/config";
import { EMPTY_QUERY } from "@/lib/job-search/search";
import { isJobSource, knownPortals, sourceInfo } from "@/lib/job-search/sources";
import { createTestClient, resetDatabase } from "@/test/db";

import { installPortal, loadInstalledPortals, previewConfig, removeInstalledPortal } from "./installed";
import { portalConfigSchema } from "./format";
import { jsonSample } from "./samples.test-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
const prisma = () => db.client!;

const sample = { ...jsonSample, termsUrl: "https://sample.example/terms" };
const text = JSON.stringify(sample);

beforeEach(async () => {
  await resetDatabase(prisma());
  await loadInstalledPortals();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => prisma().$disconnect());

describe("a portal added from a file or a link (E23-3)", () => {
  it("is shown before it's added: what it is, every host it reaches, what it asks for, its terms, and that it's not reviewed", () => {
    const result = previewConfig(text);
    expect(result.ok && result.preview).toEqual({
      text,
      id: "SAMPLE_JSON",
      name: "Sample Board",
      version: "1.0.0",
      description: "A JSON API.",
      countries: ["de", "at"],
      kinds: ["any"],
      hosts: ["api.sample.example"],
      asks: ["API key"],
      termsUrl: "https://sample.example/terms",
      reviewed: false,
      installedVersion: null,
    });
  });

  it("is refused, saying what's wrong, when it isn't a config Dossier can use", () => {
    expect(previewConfig("{ nope")).toEqual({ ok: false, problems: ["It isn't JSON: a portal config is a .json file."] });
    const missing = previewConfig(JSON.stringify({ ...sample, hosts: undefined }));
    expect(missing.ok).toBe(false);
    expect(!missing.ok && missing.problems).toContainEqual(expect.stringMatching(/^hosts: /));
    expect(previewConfig(JSON.stringify({ ...sample, id: "JSEARCH" }))).toEqual({ ok: false, problems: ["id: JSEARCH is a portal Dossier comes with. Give this one an id of its own."] });
    expect(previewConfig(" ".repeat(210 * 1024))).toMatchObject({ ok: false, problems: [expect.stringContaining("bigger than a portal config")] });
  });

  it("is kept as a pinned copy, known everywhere, and searched like a built-in", async () => {
    await installPortal(portalConfigSchema.parse(sample), { origin: "file" });
    expect(isJobSource("SAMPLE_JSON")).toBe(true);
    expect(sourceInfo("SAMPLE_JSON")).toMatchObject({ name: "Sample Board", countries: ["de", "at"] });
    expect(knownPortals().at(-1)).toEqual({ id: "SAMPLE_JSON", name: "Sample Board" });
    const again = previewConfig(text);
    expect(again.ok && again.preview.installedVersion).toBe("1.0.0");

    const config = await loadJobSearchConfig();
    const added = config.portals.find((portal) => portal.id === "SAMPLE_JSON")!;
    expect(added).toMatchObject({ on: false, installed: { origin: "file", originUrl: null, reviewed: false } });
    // Its key, like any portal's.
    expect(() => credentialsFor(config, "SAMPLE_JSON")).toThrow("Add your Sample Board key in Settings → Job search first.");

    const requests = stubFetch(() => json({ meta: { count: 1 }, results: [{ id: 1, title: "Designer", employer: { name: "Northwind" }, location: { city: "Berlin" }, link: "https://sample.example/jobs/1" }] }));
    const page = await searchPostings("SAMPLE_JSON", { key: "sk" }, { ...EMPTY_QUERY, keywords: "designer", country: "de" }, null, { baseUrl: "http://fake.test/sample_json" });
    expect(page.postings).toEqual([expect.objectContaining({ source: "SAMPLE_JSON", title: "Designer" })]);
    expect(String(requests[0].url)).toMatch(/^http:\/\/fake\.test\/sample_json\/de\/jobs/);
  });

  it("leaves out a stored config that no longer reads, and goes when it's removed", async () => {
    await prisma().installedPortal.create({ data: { id: "BROKEN", config: { id: "BROKEN" }, version: "1.0.0", origin: "file" } });
    await installPortal(portalConfigSchema.parse(sample), { origin: "link", originUrl: "https://example.com/sample.json" });
    expect((await loadInstalledPortals()).map((portal) => portal.config.id)).toEqual(["SAMPLE_JSON"]);
    expect(isJobSource("BROKEN")).toBe(false);

    expect(await removeInstalledPortal("SAMPLE_JSON")).toBe(true);
    expect(isJobSource("SAMPLE_JSON")).toBe(false);
    // What it found keeps its id as its name.
    expect(sourceInfo("SAMPLE_JSON").name).toBe("SAMPLE_JSON");
  });
});
