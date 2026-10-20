import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey, encryptApiKey } from "@/lib/ai/api-key";
import { decryptSecret, encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";
import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { buildExport, EXPORT_SCHEMA_VERSION } from "./data-export";
import { currentSummary, importExport, parseExport } from "./data-import";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));

const client = createTestClient();
const prisma = () => client;
const secret = "s".repeat(32);
const now = new Date(2026, 8, 28, 12);
/** An export as it travels: through JSON and back through the schema. */
const asFile = async (options = {}) => {
  const parsed = parseExport(JSON.stringify(await buildExport(prisma(), { now, ...options })));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
};
const snapshot = async () => JSON.stringify(await buildExport(prisma(), { now }));

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
  await prisma().theme.create({ data: { id: "mine", name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#224466" } });
  const ledgerly = await prisma().application.findFirstOrThrow({ where: { documents: { some: {} } } });
  await prisma().document.updateMany({ where: { applicationId: ledgerly.id, kind: "RESUME" }, data: { themeId: "mine" } });
  await prisma().note.create({ data: { applicationId: ledgerly.id, body: "Called John." } });
  // A version, so the round trip covers document history (E8-10).
  const resume = await prisma().document.findFirstOrThrow({ where: { applicationId: ledgerly.id, kind: "RESUME" } });
  await prisma().documentVersion.create({ data: { documentId: resume.id, units: resume.units ?? [], cause: "WRITTEN", createdAt: now } });
  await prisma().setting.create({ data: { key: "apiKeyEnc", value: encryptApiKey("sk-current", secret) } });
});
afterAll(() => prisma().$disconnect());

describe("importExport (E10-6)", () => {
  it("restores everything as it was exported", async () => {
    const file = await asFile();
    const before = await snapshot();

    // Things change after the export…
    await prisma().application.deleteMany({ where: { company: "Oaken Studio" } });
    await prisma().project.deleteMany();
    await prisma().skill.create({ data: { name: "Kubernetes" } });
    await prisma().setting.upsert({ where: { key: "paper" }, create: { key: "paper", value: "LETTER" }, update: { value: "LETTER" } });
    await prisma().theme.create({ data: { id: "later", name: "Later", headFont: "GEIST", bodyFont: "GEIST", accent: "#000000" } });

    // …and the import puts it back exactly, versions included.
    await importExport(prisma(), file);
    expect(await snapshot()).toBe(before);
    expect(await prisma().documentVersion.count()).toBe(1);
    expect(await prisma().theme.count({ where: { builtIn: true } })).toBe(12);
    expect(await prisma().projectSkill.count()).toBe(3);
  });

  it("keeps the next interview's date, and reads older files without it (E9-9)", async () => {
    const file = await asFile();
    const at = file.applications.find((application) => application.company === "Northstar Health")!.nextInterviewAt;
    expect(at).toBeInstanceOf(Date);
    await importExport(prisma(), file);
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Northstar Health" } })).toMatchObject({ nextInterviewAt: at });

    const older = { ...file, applications: file.applications.map((application) => ({ ...application, nextInterviewAt: undefined })) };
    const parsed = parseExport(JSON.stringify(older));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(prisma(), parsed.data);
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Northstar Health" } })).toMatchObject({ nextInterviewAt: null });
  });

  it("deletes every background job, since their inputs and results hold the data it replaces", async () => {
    const ledgerly = await prisma().application.findFirstOrThrow({ where: { documents: { some: {} } } });
    await prisma().job.createMany({
      data: [
        { type: "write-email", key: `email:${ledgerly.id}`, applicationId: ledgerly.id, status: "DONE", input: {} },
        { type: "import-profile", key: "profile-import", status: "DONE", input: { resume: "Jane Doe, jane@example.com" } },
        { type: "read-posting", status: "DONE", input: { posting: "A posting never applied to" } },
      ],
    });
    await importExport(prisma(), await asFile());
    expect(await prisma().job.count()).toBe(0);
  });

  it("keeps the current API key when the file has none", async () => {
    await importExport(prisma(), await asFile());
    const saved = await prisma().setting.findUniqueOrThrow({ where: { key: "apiKeyEnc" } });
    expect(decryptApiKey(saved.value, secret)).toBe("sk-current");
  });

  it("keeps this install's usage ping ID, day and answer, whatever the file says", async () => {
    const file = await asFile();
    await prisma().setting.createMany({
      data: [
        { key: "usagePingId", value: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c" },
        { key: "usagePingDay", value: "2026-09-28" },
        { key: "usagePingChoice", value: "on" },
        { key: "usagePingChoiceAt", value: "2026-10-20T08:00:00.000Z" },
        { key: "usagePingChoiceText", value: "1" },
      ],
    });
    const fromElsewhere = [
      { key: "usagePingId", value: "00000000-0000-4000-8000-000000000000" },
      { key: "usagePingDay", value: "2026-01-01" },
      { key: "usagePingChoice", value: "off" },
    ];
    await importExport(prisma(), { ...file, settings: [...file.settings, ...fromElsewhere] });
    const kept = await prisma().setting.findMany({ where: { key: { startsWith: "usagePing" } }, orderBy: { key: "asc" } });
    expect(kept.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "usagePingChoice", value: "on" },
      { key: "usagePingChoiceAt", value: "2026-10-20T08:00:00.000Z" },
      { key: "usagePingChoiceText", value: "1" },
      { key: "usagePingDay", value: "2026-09-28" },
      { key: "usagePingId", value: "6f1c0e5a-9b1d-4c3e-8f2a-1d2e3f4a5b6c" },
    ]);
  });

  it("saves the file's API key, encrypted for this server", async () => {
    const file = await asFile();
    await importExport(prisma(), { ...file, apiKey: "sk-from-file" });
    const saved = await prisma().setting.findUniqueOrThrow({ where: { key: "apiKeyEnc" } });
    expect(saved.value).not.toContain("sk-from-file");
    expect(decryptApiKey(saved.value, secret)).toBe("sk-from-file");
  });

  it("restores Find jobs' postings with their applications, and leaves a missing one unlinked (E14-9)", async () => {
    const ledgerly = await prisma().application.findFirstOrThrow({ where: { documents: { some: {} } } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Designer", savedAt: now, applicationId: ledgerly.id } });
    await prisma().posting.create({ data: { source: "ADZUNA", externalId: "job-2", dismissedAt: now } });
    const file = await asFile();
    expect(file.postings).toHaveLength(2);

    await prisma().posting.deleteMany();
    await importExport(prisma(), file);
    expect(await prisma().posting.findMany({ orderBy: { externalId: "asc" }, select: { externalId: true, applicationId: true, savedAt: true, dismissedAt: true } })).toEqual([
      { externalId: "job-1", applicationId: ledgerly.id, savedAt: now, dismissedAt: null },
      { externalId: "job-2", applicationId: null, savedAt: null, dismissedAt: now },
    ]);

    await importExport(prisma(), { ...file, applications: file.applications.filter((application) => application.id !== ledgerly.id) });
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "job-1" } })).toMatchObject({ applicationId: null });
  });

  it("restores past searches with what they found (E14-10)", async () => {
    await prisma().postingSearch.create({
      data: { source: "JSEARCH", query: { keywords: "designer" }, postings: [{ externalId: "job-1" }], found: 1, next: "cursor:2", createdAt: now },
    });
    const file = await asFile();
    expect(file.searches).toHaveLength(1);
    await prisma().postingSearch.deleteMany();
    await importExport(prisma(), file);
    expect(await prisma().postingSearch.findFirstOrThrow()).toMatchObject({
      query: { keywords: "designer" },
      postings: [{ externalId: "job-1" }],
      found: 1,
      next: "cursor:2",
      createdAt: now,
    });
  });

  it("restores the job agent's candidates and drafts, so what it saw stays seen (E16)", async () => {
    const draft = await prisma().application.create({ data: { title: "Agent draft", origin: "AGENT", agentScore: 88, awaitingReview: true } });
    await prisma().agentCandidate.create({
      data: { source: "JSEARCH", externalId: "job-1", title: "Data Scientist", score: 88, reasons: ["Python"], status: "DRAFTED", applicationId: draft.id, dedupeKey: "key-1" },
    });
    await prisma().agentCandidate.create({ data: { source: "ADZUNA", externalId: "az-1", title: "Gone", status: "DISMISSED", dedupeKey: "key-2" } });
    const file = await asFile();
    expect(file.agentCandidates).toHaveLength(2);
    expect(file.applications.find((application) => application.id === draft.id)).toMatchObject({ origin: "AGENT", agentScore: 88, awaitingReview: true });

    await prisma().agentCandidate.deleteMany();
    // A score is made again from the profile, so it's neither exported nor kept by an import (#208).
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "job-1", score: 80, reasons: [], redFlags: [], scoredWith: "score-posting@1" } });
    expect(JSON.stringify(file)).not.toContain("scoredWith");
    await importExport(prisma(), file);
    expect(await prisma().postingScore.count()).toBe(0);
    expect(await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" }, select: { externalId: true, status: true, applicationId: true, reasons: true } })).toEqual([
      { externalId: "az-1", status: "DISMISSED", applicationId: null, reasons: null },
      { externalId: "job-1", status: "DRAFTED", applicationId: draft.id, reasons: ["Python"] },
    ]);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ origin: "AGENT", awaitingReview: true });

    // Files from before the agent have none, and their applications are the user's own.
    const older = JSON.parse(JSON.stringify(file));
    delete older.agentCandidates;
    for (const application of older.applications) for (const key of ["origin", "agentScore", "awaitingReview"]) delete application[key];
    const parsed = parseExport(JSON.stringify(older));
    expect(parsed).toMatchObject({ ok: true, data: { agentCandidates: [] } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().agentCandidate.count()).toBe(0);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ origin: "MANUAL", awaitingReview: false });
  });

  it("reads files from before projects as having none (PRO-13)", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 2, profile: { ...file.profile, projects: undefined } }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 2, profile: { projects: [] } } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().project.count()).toBe(0);
  });

  it("reads version 1 files, which have no postings", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 1, postings: undefined, searches: undefined }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 1, postings: [], searches: [] } });
  });

  it("keeps saved job source keys the file doesn't carry, and saves the ones it does, encrypted (E14-9)", async () => {
    await prisma().setting.createMany({
      data: [
        { key: "jsearchKeyEnc", value: encryptSecret(JOB_SOURCE_KEY, "ak-current", secret) },
        { key: "adzunaKeyEnc", value: encryptSecret(JOB_SOURCE_KEY, "adz-current", secret) },
      ],
    });
    const file = await asFile();
    expect(file.settings.map((setting) => setting.key)).not.toContain("jsearchKeyEnc");

    await importExport(prisma(), { ...file, jobSourceKeys: { jsearch: "ak-from-file" } });
    const value = async (key: string) => decryptSecret(JOB_SOURCE_KEY, (await prisma().setting.findUniqueOrThrow({ where: { key } })).value, secret);
    expect(await value("jsearchKeyEnc")).toBe("ak-from-file");
    expect(await value("adzunaKeyEnc")).toBe("adz-current");
    expect(decryptApiKey((await prisma().setting.findUniqueOrThrow({ where: { key: "apiKeyEnc" } })).value, secret)).toBe("sk-current");
  });

  it("points documents at the base theme when their theme isn't in the file", async () => {
    const file = await asFile();
    await importExport(prisma(), { ...file, themes: [] });
    expect(await prisma().document.count({ where: { themeId: "mine" } })).toBe(0);
  });

  it("changes nothing when the import fails halfway", async () => {
    const file = await asFile();
    const before = await snapshot();
    const [first] = file.applications;
    // Two applications with the same ID: the database refuses the second.
    await expect(importExport(prisma(), { ...file, applications: [...file.applications, { ...first, events: [], documents: [], messages: [], notes: [] }] })).rejects.toThrow();
    expect(await snapshot()).toBe(before);
  });

  it("counts what's there", async () => {
    expect(await currentSummary(prisma())).toEqual({ applications: 9, roles: 3, skills: 7, themes: 1, notes: 1 });
  });
});

describe("parseExport (E10-6)", () => {
  it("explains what's wrong with a file", async () => {
    const good = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    expect(parseExport("not json")).toEqual({ ok: false, error: "That file isn't a Dossier export: it isn't JSON." });
    expect(parseExport(JSON.stringify({ hello: "world" }))).toEqual({ ok: false, error: "That file isn't a Dossier export." });
    expect(parseExport(JSON.stringify({ ...good, schemaVersion: EXPORT_SCHEMA_VERSION + 1 }))).toEqual({
      ok: false,
      error: `That export comes from a newer version of Dossier (schema ${EXPORT_SCHEMA_VERSION + 1}). Update this server first.`,
    });
    expect(parseExport(JSON.stringify({ ...good, schemaVersion: 0 }))).toMatchObject({ ok: false, error: expect.stringMatching(/isn't one this version/) });
    const damaged = { ...good, applications: [{ ...good.applications[0], status: "MAYBE" }] };
    expect(parseExport(JSON.stringify(damaged))).toMatchObject({ ok: false, error: expect.stringMatching(/^That export is damaged or incomplete \(applications\.0\.status/) });
  });
});
