import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptApiKey } from "@/lib/ai/api-key";
import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { buildExport, EXPORT_SCHEMA_VERSION, exportFileName, exportSchema } from "./data-export";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));

const client = createTestClient();
const prisma = () => client;
const now = new Date(2026, 8, 28, 12);

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
  await prisma().theme.create({ data: { id: "mine", name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#224466" } });
  await prisma().setting.create({ data: { key: "apiKeyEnc", value: encryptApiKey("sk-test-123", "s".repeat(32)) } });
});
afterAll(() => prisma().$disconnect());

describe("buildExport (E10-4)", () => {
  it("has everything, with IDs, and reads back through the import schema", async () => {
    const data = await buildExport(prisma(), { now });
    const file = exportSchema.parse(JSON.parse(JSON.stringify(data)));

    expect(file).toMatchObject({ format: "dossier-export", schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: now });
    expect(file.profile.skills.length).toBe(await prisma().skill.count());
    expect(file.profile.experience.flatMap((entry) => entry.skillIds).length).toBe(await prisma().experienceSkill.count());
    // Projects with their skills (PRO-13).
    expect(file.profile.projects.map((entry) => entry.name)).toEqual(["Tidewater design tokens"]);
    expect(file.profile.projects.flatMap((entry) => entry.skillIds).length).toBe(await prisma().projectSkill.count());
    expect(file.profile.references.length).toBe(await prisma().reference.count());
    expect(file.applications.length).toBe(await prisma().application.count());
    expect(file.applications.flatMap((application) => application.events).length).toBe(await prisma().statusEvent.count());
    expect(file.applications.flatMap((application) => application.documents).length).toBe(await prisma().document.count());
    expect(file.applications.flatMap((application) => application.messages).length).toBe(await prisma().chatMessage.count());

    // Only the user's own themes, and the IDs that tie things together.
    expect(file.themes.map((theme) => theme.id)).toEqual(["mine"]);
    const ledgerly = file.applications.find((application) => application.documents.length > 0)!;
    expect(ledgerly.documents[0].id).toBe((await prisma().document.findFirstOrThrow({ where: { applicationId: ledgerly.id, kind: ledgerly.documents[0].kind } })).id);
  });

  it("leaves the API key out unless asked, and then gives it in plain text", async () => {
    const without = await buildExport(prisma(), { now });
    expect(without).not.toHaveProperty("apiKey");
    expect(JSON.stringify(without)).not.toContain("apiKeyEnc");

    const withKey = await buildExport(prisma(), { now, includeApiKey: true });
    expect(withKey.apiKey).toBe("sk-test-123");
    expect(withKey.settings.map((setting) => setting.key)).not.toContain("apiKeyEnc");
  });

  it("leaves out the install's own settings: the usage ping's ID, day and answer", async () => {
    await prisma().setting.createMany({
      data: [
        { key: "usagePingId", value: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c" },
        { key: "usagePingDay", value: "2026-09-28" },
        { key: "usagePingChoice", value: "on" },
        { key: "usagePingChoiceAt", value: "2026-10-20T08:00:00.000Z" },
        { key: "usagePingChoiceText", value: "1" },
      ],
    });
    const data = await buildExport(prisma(), { now, includeApiKey: true });
    expect(data.settings.map((setting) => setting.key)).not.toContain("usagePingId");
    expect(JSON.stringify(data)).not.toContain("6f1c0e5a");
    expect(JSON.stringify(data)).not.toContain("usagePing");
  });

  it("treats the job sources' keys like the API key, and has the postings (E14-9)", async () => {
    await prisma().setting.createMany({
      data: [
        { key: "jsearchKeyEnc", value: encryptSecret(JOB_SOURCE_KEY, "ak-test", "s".repeat(32)) },
        // Unreadable here: left out rather than exported broken.
        { key: "adzunaKeyEnc", value: encryptSecret(JOB_SOURCE_KEY, "adz-test", "x".repeat(32)) },
      ],
    });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Designer", savedAt: now } });

    const without = await buildExport(prisma(), { now });
    expect(without).not.toHaveProperty("jobSourceKeys");
    expect(JSON.stringify(without)).not.toMatch(/jsearchKeyEnc|adzunaKeyEnc/);
    expect(without.postings).toEqual([expect.objectContaining({ externalId: "job-1", title: "Designer", savedAt: now })]);

    const withKeys = await buildExport(prisma(), { now, includeApiKey: true });
    expect(withKeys.jobSourceKeys).toEqual({ jsearch: "ak-test" });
  });

  it("names the file after the day", () => {
    expect(exportFileName(new Date(2026, 8, 7, 23))).toBe("dossier-export-2026-09-07.json");
  });

  it("refuses files it doesn't know", () => {
    expect(exportSchema.safeParse({ format: "something-else" }).success).toBe(false);
  });
});
