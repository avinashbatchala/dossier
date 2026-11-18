import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptApiKey, encryptApiKey } from "@/lib/ai/api-key";
import { decryptSecret, encryptSecret, JOB_SOURCE_KEY, TYPESAFE_KEY } from "@/lib/secrets";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { buildExport, EXPORT_SCHEMA_VERSION, exportSchema } from "./data-export";
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
    await prisma().fact.deleteMany();
    await prisma().skill.create({ data: { profileId: TEST_PROFILE_ID, name: "Kubernetes" } });
    await prisma().setting.upsert({ where: { key: "paper" }, create: { key: "paper", value: "LETTER" }, update: { value: "LETTER" } });
    await prisma().theme.create({ data: { id: "later", name: "Later", headFont: "GEIST", bodyFont: "GEIST", accent: "#000000" } });

    // …and the import puts it back exactly, versions included.
    await importExport(prisma(), file);
    expect(await snapshot()).toBe(before);
    expect(await prisma().documentVersion.count()).toBe(1);
    expect(await prisma().theme.count({ where: { builtIn: true } })).toBe(12);
    expect(await prisma().projectSkill.count()).toBe(3);
    expect(await prisma().fact.count()).toBe(3);
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

  it("keeps skill groups, and reads files from before them as having none (#280)", async () => {
    await prisma().skill.updateMany({ where: { name: "Figma" }, data: { group: "Tools" } });
    const file = await asFile();
    expect(file.profile.skills.find((skill) => skill.name === "Figma")).toMatchObject({ group: "Tools" });
    await importExport(prisma(), file);
    expect(await prisma().skill.findFirstOrThrow({ where: { name: "Figma" } })).toMatchObject({ group: "Tools" });

    const older = { ...file, schemaVersion: 6, profile: { ...file.profile, skills: file.profile.skills.map((skill) => Object.fromEntries(Object.entries(skill).filter(([key]) => key !== "group"))) } };
    const parsed = parseExport(JSON.stringify(older));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(prisma(), parsed.data);
    expect(await prisma().skill.findFirstOrThrow({ where: { name: "Figma" } })).toMatchObject({ group: "" });
  });

  it("keeps every profile with its own sections and settings (E24-1)", async () => {
    await prisma().profile.create({
      data: { id: "backend", name: "Backend", sort: 1, headline: "Backend Engineer", summary: "APIs.", levelFrom: "senior", levelTo: "lead", workplace: { modes: ["REMOTE"], radiusKm: 25, otherPlaces: [], remoteOpenTo: "anywhere", remoteCountries: [], relocate: false, relocatePlaces: [] }, settings: { fitBaseResume: "true" } },
    });
    await prisma().skill.create({ data: { profileId: "backend", name: "Figma" } });
    await prisma().experience.create({ data: { profileId: "backend", role: "API Engineer" } });
    await prisma().customSection.create({ data: { profileId: "backend", title: "Bootcamps", countsAs: "EDUCATION" } });
    // What's tied to a profile keeps it (E24-6).
    await prisma().application.create({ data: { id: "go-app", title: "Go at Acme", profileId: "backend", knownGaps: { create: { requirement: "Kubernetes" } }, interviews: { create: { round: 1, at: new Date("2026-12-03T10:00:00Z"), minutes: 60, prep: [{ text: "Reread the posting", why: "", done: true }] } }, offer: { create: { salary: "€82,000", decideBy: new Date("2026-12-11T00:00:00Z") } }, contactedAt: new Date("2026-11-20T10:00:00Z") } });
    await prisma().agentSearch.create({ data: { id: "go-search", name: "Go", query: { keywords: "Go", place: "", country: "nl", radiusKm: 50, remoteOnly: false, postedWithin: "any" }, profileId: "backend" } });
    await prisma().startup.create({ data: { id: "go-startup", source: "HN", externalId: "go", company: "Gopher", roles: [], emails: [], links: [], reasons: [], profileId: "backend" } });
    const file = await asFile();
    expect(file.schemaVersion).toBe(16);
    expect(file.profiles?.map((profile) => profile.name)).toEqual(["Senior Product Designer", "Backend"]);
    await prisma().profile.deleteMany({ where: { id: "backend" } });

    await importExport(prisma(), file);
    const backend = await prisma().profile.findUniqueOrThrow({ where: { id: "backend" }, include: { skills: true, experiences: true, customSections: true } });
    // What a section counts as travels with it (E24-5); a file before version 13 has none, so every one is Extra activities.
    expect(backend.customSections.map((section) => section.countsAs)).toEqual(["EDUCATION"]);
    expect(backend).toMatchObject({ headline: "Backend Engineer", levelFrom: "senior", levelTo: "lead", workplace: { modes: ["REMOTE"], remoteOpenTo: "anywhere" }, settings: { fitBaseResume: "true" } });
    expect(backend.skills.map((skill) => skill.name)).toEqual(["Figma"]);
    expect(backend.experiences.map((role) => role.role)).toEqual(["API Engineer"]);
    // The same skill name in two profiles is two skills.
    expect(await prisma().skill.count({ where: { name: "Figma" } })).toBe(2);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "go-app" } })).toMatchObject({ profileId: "backend" });
    // "I don't have this" travels with its application (E30-5).
    expect(await prisma().knownGap.findMany({ select: { applicationId: true, requirement: true } })).toEqual([{ applicationId: "go-app", requirement: "Kubernetes" }]);
    // So do its offer and when it was last written to (E30-7, E30-8).
    expect(await prisma().offer.findMany({ select: { applicationId: true, salary: true, decideBy: true } })).toEqual([{ applicationId: "go-app", salary: "€82,000", decideBy: new Date("2026-12-11T00:00:00Z") }]);
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "go-app" } })).contactedAt).toEqual(new Date("2026-11-20T10:00:00Z"));
    // So do its interview rounds (E30-6).
    expect(await prisma().interview.findMany({ select: { applicationId: true, round: true, minutes: true, prep: true } })).toEqual([
      { applicationId: "go-app", round: 1, minutes: 60, prep: [{ text: "Reread the posting", why: "", done: true }] },
    ]);
    expect(await prisma().agentSearch.findUniqueOrThrow({ where: { id: "go-search" } })).toMatchObject({ profileId: "backend" });
    expect(await prisma().startup.findUniqueOrThrow({ where: { id: "go-startup" } })).toMatchObject({ profileId: "backend" });

    // A profile that isn't in the file leaves them with none, so they read the first.
    const gone = <T extends { profileId?: string | null }>(row: T) => ({ ...row, profileId: row.profileId === "backend" ? "gone" : row.profileId });
    await importExport(prisma(), { ...file, applications: file.applications.map(gone), agentSearches: file.agentSearches?.map(gone), startups: file.startups?.map(gone) });
    expect(await prisma().application.findUniqueOrThrow({ where: { id: "go-app" } })).toMatchObject({ profileId: null });
    expect(await prisma().agentSearch.findUniqueOrThrow({ where: { id: "go-search" } })).toMatchObject({ profileId: null });
    expect(await prisma().startup.findUniqueOrThrow({ where: { id: "go-startup" } })).toMatchObject({ profileId: null });
  });

  it("keeps notification channels and their grid, without their secrets, and each keeps its own secret here (E26-2, E26-3)", async () => {
    const { decryptSecret, encryptSecret, NOTIFICATION_SECRET } = await import("@/lib/secrets");
    await prisma().notificationChannel.create({
      data: { id: "inbox", type: "EMAIL", name: "Inbox", config: { host: "smtp.example.com", port: 587, user: "me", from: "a@b.c", to: "d@e.f" }, events: { "draft.ready": true }, secretEnc: encryptSecret(NOTIFICATION_SECRET, "smtp-pw"), sort: 0 },
    });
    await prisma().notificationChannel.create({ data: { id: "hook", type: "WEBHOOK", name: "n8n", config: { url: "https://n8n.example/hook" }, secretEnc: encryptSecret(NOTIFICATION_SECRET, "whsec_kept"), sort: 1 } });
    const file = await asFile();
    expect(JSON.stringify(file)).not.toContain("smtp-pw");
    expect(JSON.stringify(file)).not.toContain("whsec_kept");
    expect(file.notificationChannels.map((channel) => [channel.name, channel.events])).toEqual([
      ["Inbox", { "draft.ready": true }],
      ["n8n", {}],
    ]);

    // A webhook new to this install gets a secret of its own.
    await importExport(prisma(), { ...file, notificationChannels: [...file.notificationChannels, { ...file.notificationChannels[1], id: "other", name: "Other", sort: 2 }] });
    const rows = await prisma().notificationChannel.findMany({ orderBy: { sort: "asc" } });
    expect(rows.map((row) => [row.name, row.secretEnc === null ? null : decryptSecret(NOTIFICATION_SECRET, row.secretEnc).slice(0, 6)])).toEqual([
      ["Inbox", "smtp-p"],
      ["n8n", "whsec_"],
      ["Other", "whsec_"],
    ]);
    expect(decryptSecret(NOTIFICATION_SECRET, rows[1].secretEnc!)).toBe("whsec_kept");
    expect(decryptSecret(NOTIFICATION_SECRET, rows[2].secretEnc!)).not.toBe("whsec_kept");
  });

  it("reads a file from before profiles as one, named after its headline, with the Base resume's settings (E24-1)", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const [first] = file.profiles;
    const strip = (rows: object[]) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "profileId")));
    const older = {
      ...file,
      schemaVersion: 12,
      profiles: undefined,
      profile: {
        ...file.profile,
        fields: [...file.profile.fields, { key: "headline", value: first.headline }, { key: "summary", value: first.summary }],
        skills: strip(file.profile.skills),
        experience: strip(file.profile.experience),
        education: strip(file.profile.education),
      },
      settings: [...file.settings, { key: "fitBaseResume", value: "true" }, { key: "experienceOrder", value: "manual" }],
    };
    const parsed = parseExport(JSON.stringify(older));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(prisma(), parsed.data);

    const profiles = await prisma().profile.findMany({ include: { _count: { select: { skills: true, experiences: true } } } });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ name: "Senior Product Designer", headline: first.headline, summary: first.summary, settings: { fitBaseResume: "true", experienceOrder: "manual" } });
    expect(profiles[0]._count).toEqual({ skills: file.profile.skills.length, experiences: file.profile.experience.length });
    // The headline, summary and Base resume settings are the profile's now, not shared.
    expect(await prisma().profileField.findMany({ where: { key: { in: ["headline", "summary"] } } })).toEqual([]);
    expect(await prisma().setting.findMany({ where: { key: { in: ["fitBaseResume", "experienceOrder"] } } })).toEqual([]);
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

  it("restores past searches with what they found (E14-10, E22-5)", async () => {
    const search = await prisma().postingSearch.create({
      data: { source: "JSEARCH", query: { keywords: "designer" }, portals: [{ id: "JSEARCH", status: "done", found: 1, next: "cursor:2", message: null }], found: 1, createdAt: now },
    });
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Designer", lastFoundAt: now } });
    await prisma().postingFind.create({ data: { postingId: posting.id, searchId: search.id, portal: "JSEARCH", foundAt: now } });
    const file = await asFile();
    expect(file.searches).toHaveLength(1);
    expect(file.postingFinds).toEqual([expect.objectContaining({ postingId: posting.id, searchId: search.id, portal: "JSEARCH" })]);
    await importExport(prisma(), file);
    expect(await prisma().postingSearch.findFirstOrThrow()).toMatchObject({ query: { keywords: "designer" }, found: 1, portals: [{ id: "JSEARCH", next: "cursor:2" }], createdAt: now });
    expect(await prisma().postingFind.count()).toBe(1);
  });

  it("keeps the same job on two portals as one (E22-6)", async () => {
    const shown = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "job-1", title: "Designer", company: "Northwind GmbH", matchCompany: "northwind" } });
    await prisma().posting.create({ data: { source: "ADZUNA", externalId: "az-1", title: "Designer", company: "Northwind", matchCompany: "northwind", mergedIntoId: shown.id } });
    const file = await asFile();
    expect(file.postings[0]).not.toHaveProperty("matchCompany");
    await importExport(prisma(), file);
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "az-1" } })).toMatchObject({ mergedIntoId: shown.id, matchCompany: "northwind" });
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "job-1" } })).toMatchObject({ mergedIntoId: null, matchCompany: "northwind" });
  });

  it("keeps the job agent's runs and what they found (E22-8)", async () => {
    const agentSearch = await prisma().agentSearch.create({ data: { name: "Designers", query: { keywords: "designer", place: "", country: "de", radiusKm: 25, remoteOnly: false, postedWithin: "any" } } });
    const run = await prisma().postingSearch.create({ data: { query: { keywords: "designer" }, agentSearchId: agentSearch.id, agentSearchName: "Designers" } });
    const posting = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "found" } });
    await prisma().postingFind.create({ data: { postingId: posting.id, searchId: run.id, portal: "JSEARCH" } });
    await importExport(prisma(), await asFile());
    expect(await prisma().postingSearch.findFirstOrThrow()).toMatchObject({ agentSearchId: agentSearch.id, agentSearchName: "Designers" });
    expect(await prisma().postingFind.count()).toBe(1);
  });

  it("puts what the agent found in a file from before into Positions (E22-8)", async () => {
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "old", dedupeKey: "old", title: "Designer", score: 82, reasons: ["Fits."], redFlags: [] } });
    const file = await asFile();
    await importExport(prisma(), file);
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "old" } })).toMatchObject({ title: "Designer" });
    expect(await prisma().postingSearch.findFirstOrThrow()).toMatchObject({ agentSearchName: "" });
  });

  it("keeps the portals the user added, and leaves out one that no longer reads (E23-3)", async () => {
    const { jsonSample } = await import("@/lib/portals/samples.test-data");
    await prisma().installedPortal.create({ data: { id: "SAMPLE_JSON", config: jsonSample, version: "1.0.0", origin: "link", originUrl: "https://example.com/sample.json" } });
    const file = await asFile();
    expect(file.installedPortals).toEqual([expect.objectContaining({ id: "SAMPLE_JSON", origin: "link", originUrl: "https://example.com/sample.json" })]);
    await importExport(prisma(), { ...file, installedPortals: [...file.installedPortals, { ...file.installedPortals[0], id: "BROKEN", config: { id: "BROKEN" } }] });
    expect(await prisma().installedPortal.findMany({ select: { id: true, version: true, reviewed: true } })).toEqual([{ id: "SAMPLE_JSON", version: "1.0.0", reviewed: false }]);
  });

  it("keeps the Archive as it was (E22-7)", async () => {
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "archived", archivedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "removed", archivedAt: now, removedAt: now } });
    await prisma().posting.create({ data: { source: "JSEARCH", externalId: "back", movedBackAt: now } });
    await importExport(prisma(), await asFile());
    const rows = await prisma().posting.findMany({ orderBy: { externalId: "asc" }, select: { externalId: true, archivedAt: true, movedBackAt: true, removedAt: true } });
    expect(rows).toEqual([
      { externalId: "archived", archivedAt: now, movedBackAt: null, removedAt: null },
      { externalId: "back", archivedAt: null, movedBackAt: now, removedAt: null },
      { externalId: "removed", archivedAt: now, movedBackAt: null, removedAt: now },
    ]);
  });

  it("moves what a search from before version 12 kept as JSON into the library", async () => {
    const file = await asFile();
    const old = {
      ...file,
      schemaVersion: 11 as const,
      postingFinds: [],
      searches: [{ id: "s-old", source: "ADZUNA", query: { keywords: "designer" }, postings: [{ source: "ADZUNA", externalId: "az-1", title: "Designer", company: "", place: "", remote: null, salary: "", postedAt: null, url: "", via: "", description: "", complete: false }], found: 1, next: "page:2", createdAt: now, updatedAt: now }],
    };
    await importExport(prisma(), old);
    expect(await prisma().postingSearch.findUniqueOrThrow({ where: { id: "s-old" } })).toMatchObject({ postings: [], portals: [{ id: "ADZUNA", status: "done", found: 1, next: "page:2" }] });
    expect(await prisma().posting.findFirstOrThrow({ where: { externalId: "az-1" } })).toMatchObject({ title: "Designer", seenAt: now });
    expect(await prisma().postingFind.count({ where: { searchId: "s-old" } })).toBe(1);
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
    await prisma().postingScore.create({ data: { source: "JSEARCH", externalId: "job-1", profileId: TEST_PROFILE_ID, score: 80, reasons: [], redFlags: [], scoredWith: "score-posting@1" } });
    expect(JSON.stringify(file)).not.toContain("scoredWith");
    await importExport(prisma(), file);
    // The one here is gone; the file's agent finds join Positions with the scores they had then (E22-8).
    expect(await prisma().postingScore.findMany({ select: { externalId: true, score: true } })).toEqual([{ externalId: "job-1", score: 88 }]);
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

  it("restores Startups with what the user did with them, and reads files from before them as having none (#222)", async () => {
    const application = await prisma().application.create({ data: { title: "Android · Acme" } });
    const emails = [{ email: "jobs@acme.example", label: "Hiring", from: "https://acme.example/careers", onRequest: false, foundAt: "2026-10-01T00:00:00.000Z" }];
    await prisma().startup.create({
      data: { source: "HN", externalId: "1", company: "Acme", roles: ["Engineer"], emails, links: [], reasons: ["In Berlin"], status: "SAVED", notes: "Ask about Compose", applicationId: application.id },
    });
    await prisma().startup.create({ data: { source: "YC", externalId: "2", company: "Gone", roles: [], emails: [], links: [], reasons: [], status: "DISMISSED" } });
    await prisma().startupBlock.create({ data: { hash: "b".repeat(64) } });
    const select = { externalId: true, status: true, notes: true, emails: true, roles: true, applicationId: true } as const;
    const before = await prisma().startup.findMany({ orderBy: { externalId: "asc" }, select });
    const file = await asFile();
    expect(file.startups).toHaveLength(2);

    await importExport(prisma(), file);
    expect(await prisma().startup.findMany({ orderBy: { externalId: "asc" }, select })).toEqual(before);
    expect(await prisma().startupBlock.count()).toBe(1);

    // An application that isn't in the file leaves its startup unlinked; older files have no startups.
    const unlinked = JSON.parse(JSON.stringify(file));
    unlinked.applications = unlinked.applications.filter((entry: { id: string }) => entry.id !== application.id);
    await importExport(prisma(), exportSchema.parse(unlinked));
    expect((await prisma().startup.findFirstOrThrow({ where: { externalId: "1" } })).applicationId).toBeNull();
    const older = JSON.parse(JSON.stringify(file));
    delete older.startups;
    delete older.startupBlocks;
    const parsed = parseExport(JSON.stringify(older));
    expect(parsed).toMatchObject({ ok: true, data: { startups: [], startupBlocks: [] } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().startup.count()).toBe(0);
  });

  it("reads files from before projects as having none (PRO-13)", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 2, profile: { ...file.profile, projects: undefined } }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 2, profile: { projects: [] } } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().project.count()).toBe(0);
  });

  it("restores publications, and reads files from before them as having none (#218)", async () => {
    await prisma().publication.updateMany({ data: { onResumes: false } });
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const before = await prisma().publication.findMany();
    await importExport(prisma(), exportSchema.parse(file));
    expect(await prisma().publication.findMany()).toEqual(before);

    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 4, profile: { ...file.profile, publications: undefined } }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 4, profile: { publications: [] } } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().publication.count()).toBe(0);
  });

  it("restores custom sections, an application's own order and what it was sent with, and reads files from before them as having none (#297, #298, #299)", async () => {
    await prisma().customSection.create({ data: { profileId: TEST_PROFILE_ID, id: "s1", title: "Awards", format: "LINES", countsAs: "EXTRA_ACTIVITIES" as const, items: { create: [{ id: "i1", title: "Best Paper", link: "example.org", sort: 0 }] } } });
    const application = await prisma().application.findFirstOrThrow();
    const frozen = { profile: { basics: { name: "As sent" } }, themes: { RESUME: null, COVER_LETTER: null }, paper: "A4", dateFormat: "NUMERIC", includeReferences: false, followedBase: false };
    await prisma().application.update({ where: { id: application.id }, data: { sections: { order: ["skills"], off: ["custom:s1"] }, frozen } });
    const file = await asFile();
    const sections = await prisma().customSection.findMany({ include: { items: true } });
    await importExport(prisma(), file);
    expect(await prisma().customSection.findMany({ include: { items: true } })).toEqual(sections);
    expect(await prisma().application.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ sections: { order: ["skills"], off: ["custom:s1"] }, frozen });

    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 8, profile: { ...file.profile, customSections: undefined } }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 8, profile: { customSections: [] } } });
  });

  it("restores certifications, and reads files from before them as having none (#293)", async () => {
    await prisma().certification.updateMany({ data: { onResumes: false } });
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const before = await prisma().certification.findMany();
    await importExport(prisma(), exportSchema.parse(file));
    expect(await prisma().certification.findMany()).toEqual(before);

    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 7, profile: { ...file.profile, certifications: undefined } }));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 7, profile: { certifications: [] } } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().certification.count()).toBe(0);
  });

  it("restores the line about each role's company, and reads files from before it with none (#257)", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const lines = async () => (await prisma().experience.findMany({ orderBy: { sort: "asc" } })).map((entry) => entry.descriptor);
    const before = await lines();
    expect(before).toContain("Freight platform for European carriers, 300 people");
    await importExport(prisma(), exportSchema.parse(file));
    expect(await lines()).toEqual(before);

    // undefined: left out of the JSON, as in a file from before it.
    const experience = file.profile.experience.map((entry: object) => ({ ...entry, descriptor: undefined }));
    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 5, profile: { ...file.profile, experience } }));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(prisma(), parsed.data);
    expect(await lines()).toEqual(before.map(() => ""));
  });

  it("restores which roles are volunteering, and reads files from before it with paid roles only (#294)", async () => {
    const [first] = await prisma().experience.findMany({ orderBy: { sort: "asc" } });
    await prisma().experience.update({ where: { id: first.id }, data: { volunteering: true } });
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const marks = async () => (await prisma().experience.findMany({ orderBy: { sort: "asc" } })).map((entry) => entry.volunteering);
    const before = await marks();
    expect(before.filter(Boolean)).toHaveLength(1);
    await importExport(prisma(), exportSchema.parse(file));
    expect(await marks()).toEqual(before);

    const experience = file.profile.experience.map((entry: object) => ({ ...entry, volunteering: undefined }));
    const parsed = parseExport(JSON.stringify({ ...file, schemaVersion: 7, profile: { ...file.profile, experience } }));
    if (!parsed.ok) throw new Error(parsed.error);
    await importExport(prisma(), parsed.data);
    expect(await marks()).toEqual(before.map(() => false));
  });

  it("restores the photo, the themes' photo options and each application's Photo switch, and reads older files with the defaults (#224)", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    await prisma().profileField.createMany({ data: [{ key: "photo", value: png }, { key: "photoOnResumes", value: "false" }] });
    await prisma().theme.update({ where: { id: "mine" }, data: { photoShape: "PORTRAIT", photoPosition: "SIDEBAR" } });
    await prisma().application.updateMany({ where: { company: "Ledgerly" }, data: { showPhoto: true } });
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));

    await prisma().profileField.deleteMany({ where: { key: { startsWith: "photo" } } });
    await importExport(prisma(), exportSchema.parse(file));
    const fields = await prisma().profileField.findMany({ where: { key: { startsWith: "photo" } }, orderBy: { key: "asc" } });
    expect(fields.map(({ key, value }) => [key, value])).toEqual([["photo", png], ["photoOnResumes", "false"]]);
    expect(await prisma().theme.findUniqueOrThrow({ where: { id: "mine" } })).toMatchObject({ photoShape: "PORTRAIT", photoPosition: "SIDEBAR" });
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } })).toMatchObject({ showPhoto: true });

    const older = {
      ...file,
      themes: file.themes.map((theme: object) => ({ ...theme, photoShape: undefined, photoPosition: undefined })),
      applications: file.applications.map((application: object) => ({ ...application, showPhoto: undefined })),
    };
    await importExport(prisma(), exportSchema.parse(older));
    expect(await prisma().theme.findUniqueOrThrow({ where: { id: "mine" } })).toMatchObject({ photoShape: "CIRCLE", photoPosition: "HEADER_END" });
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } })).toMatchObject({ showPhoto: null });
  });

  it("restores the board's order, and reads older files as newest first (public issue 60)", async () => {
    await prisma().application.updateMany({ where: { company: "Ledgerly" }, data: { boardSort: 4 } });
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));

    await importExport(prisma(), exportSchema.parse(file));
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } })).toMatchObject({ boardSort: 4 });

    const older = { ...file, applications: file.applications.map((application: object) => ({ ...application, boardSort: undefined })) };
    await importExport(prisma(), exportSchema.parse(older));
    expect(await prisma().application.findFirstOrThrow({ where: { company: "Ledgerly" } })).toMatchObject({ boardSort: null });
  });

  it("reads files from before facts, with an application's note as its first fact (PRO-14, APP-15)", async () => {
    const file = JSON.parse(JSON.stringify(await buildExport(prisma(), { now })));
    const [first, ...rest] = file.applications;
    const old = {
      ...file,
      schemaVersion: 3,
      profile: { ...file.profile, facts: undefined },
      applications: [
        { ...first, facts: undefined, userNote: "  Relocating in January.  " },
        ...rest.map((application: object) => ({ ...application, facts: undefined, userNote: "" })),
      ],
    };
    const parsed = parseExport(JSON.stringify(old));
    expect(parsed).toMatchObject({ ok: true, data: { schemaVersion: 3, profile: { facts: [] } } });
    if (!parsed.ok) return;
    await importExport(prisma(), parsed.data);
    expect(await prisma().fact.findMany({ select: { applicationId: true, text: true } })).toEqual([{ applicationId: first.id, text: "Relocating in January." }]);
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

    // A file from before version 12 carries one key per source; they move into the portals' storage (E22-3).
    await importExport(prisma(), { ...file, jobSourceKeys: { jsearch: "ak-from-file" } });
    const keys = JSON.parse((await prisma().setting.findUniqueOrThrow({ where: { key: "portalKeysEnc" } })).value) as Record<string, Record<string, string>>;
    expect(decryptSecret(JOB_SOURCE_KEY, keys.JSEARCH.key, secret)).toBe("ak-from-file");
    expect(decryptSecret(JOB_SOURCE_KEY, keys.ADZUNA.key, secret)).toBe("adz-current");
    expect(await prisma().setting.findUnique({ where: { key: "jsearchKeyEnc" } })).toBeNull();

    // From version 12, each portal's keys, by field.
    await importExport(prisma(), { ...(await asFile()), portalKeys: { ADZUNA: { key: "adz-from-file" } } });
    const after = JSON.parse((await prisma().setting.findUniqueOrThrow({ where: { key: "portalKeysEnc" } })).value) as Record<string, Record<string, string>>;
    expect(decryptSecret(JOB_SOURCE_KEY, after.ADZUNA.key, secret)).toBe("adz-from-file");
    expect(decryptApiKey((await prisma().setting.findUniqueOrThrow({ where: { key: "apiKeyEnc" } })).value, secret)).toBe("sk-current");
  });

  it("never exports the TypeSafe key, and keeps this server's on import (#274)", async () => {
    await prisma().setting.createMany({
      data: [
        { key: "typesafeKeyEnc", value: encryptSecret(TYPESAFE_KEY, "ts-current", secret) },
        { key: "scorer", value: "JEV" },
      ],
    });
    // Not even with the keys asked for: the TypeSafe key belongs to this server.
    const file = await asFile({ includeApiKey: true });
    expect(file.settings.map((setting) => setting.key)).not.toContain("typesafeKeyEnc");
    expect(file.settings).toContainEqual({ key: "scorer", value: "JEV" });
    expect(JSON.stringify(file)).not.toContain("ts-current");

    await importExport(prisma(), { ...file, settings: file.settings.filter((setting) => setting.key !== "scorer") });
    const kept = await prisma().setting.findUniqueOrThrow({ where: { key: "typesafeKeyEnc" } });
    expect(decryptSecret(TYPESAFE_KEY, kept.value, secret)).toBe("ts-current");
    expect(await prisma().setting.findUnique({ where: { key: "scorer" } })).toBeNull();
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
