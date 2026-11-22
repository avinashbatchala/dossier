import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadJobSearchConfig } from "@/lib/job-search/config";
import { isJobSource } from "@/lib/job-search/sources";
import { jsonSample } from "@/lib/portals/samples.test-data";
import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { installPortalConfig, previewPortal, removePortal, savePortalKey, setPortalOn } from "./actions";

// Add portal (E23-3), against the test database, signed in.
const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }),
}));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const prisma = () => db.client!;
const text = JSON.stringify(jsonSample);

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("Add portal (E23-3)", () => {
  it("shows a config before it's added, and refuses one that isn't, saying why", async () => {
    expect(await previewPortal({ text })).toMatchObject({ ok: true, data: { ok: true, preview: { id: "SAMPLE_JSON", hosts: ["api.sample.example"], reviewed: false } } });
    expect(await previewPortal({ text: "[]" })).toMatchObject({ ok: true, data: { ok: false, problems: [expect.any(String)] } });
    expect(await previewPortal({ url: "http://example.com/x.json" })).toEqual({ ok: true, data: { ok: false, problems: ["Use an https:// link to the config file."] } });
  });

  it("adds it as previewed, to switch on and give a key like any portal, and removes it with its key", async () => {
    const added = await installPortalConfig({ text, origin: "file", originUrl: null });
    expect(added).toMatchObject({ ok: true, toast: "Sample Board added. Switch it on to search it." });
    expect(added.ok && added.data.portals.at(-1)).toMatchObject({ id: "SAMPLE_JSON", on: false, installed: { origin: "file", reviewed: false, termsUrl: null } });
    expect(await prisma().installedPortal.findUniqueOrThrow({ where: { id: "SAMPLE_JSON" } })).toMatchObject({ version: "1.0.0", origin: "file", originUrl: null });

    expect(await setPortalOn({ portal: "SAMPLE_JSON", on: true })).toMatchObject({ ok: true });
    expect(await savePortalKey({ portal: "SAMPLE_JSON", field: "key", change: { action: "set", value: "sk_live" } })).toMatchObject({ ok: true });
    expect((await loadJobSearchConfig()).portals.find((portal) => portal.id === "SAMPLE_JSON")).toMatchObject({ on: true, keys: { key: { state: "set" } } });

    expect(await removePortal({ portal: "SAMPLE_JSON" })).toMatchObject({ ok: true, toast: "Sample Board removed. What it found stays in Positions." });
    expect(isJobSource("SAMPLE_JSON")).toBe(false);
    const settings = await loadSettings();
    expect(settings.portals?.SAMPLE_JSON).toBeUndefined();
    expect(settings.portalKeysEnc.SAMPLE_JSON).toBeUndefined();
  });

  it("removes only a portal the user added", async () => {
    expect(await removePortal({ portal: "JSEARCH" })).toEqual({ ok: false, error: "Only a portal you added can be removed." });
  });
});
