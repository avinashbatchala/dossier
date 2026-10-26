import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { placeOf } from "./place";
import { refreshStartups, refreshStartupsJob } from "./refresh";
import {
  blockHashes,
  getStartup,
  listStartups,
  lookUpStartup,
  markSentAsContacted,
  removeStartup,
  rescoreStartups,
  startupPostingText,
  sweepStartups,
  updateStartup,
  upsertStartups,
} from "./store";
import { startupFilterSchema, type FoundStartup, type StartupEmail } from "./types";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const profile = vi.hoisted(() => ({
  basics: { headline: "Android engineer", summary: "", city: "Berlin", country: "Germany" },
  skills: [
    { id: "1", name: "Android" },
    { id: "2", name: "Kotlin" },
  ],
  experience: [],
}));
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => profile }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
// Startups' sites and the sources answer from here, never the internet.
const web = vi.hoisted(() => ({ emails: [] as StartupEmail[], noApplicationsFrom: "", looked: [] as string[] }));
vi.mock("./emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./emails")>()),
  lookUpSite: vi.fn(async (website: string) => {
    web.looked.push(website);
    return { emails: web.emails, noApplicationsFrom: web.noApplicationsFrom, refused: false };
  }),
}));
const sources = vi.hoisted(() => ({ yc: [] as unknown[], hnFails: false }));
vi.mock("./sources/yc", () => ({ fetchYcStartups: async () => sources.yc }));
vi.mock("./sources/hn", async () => {
  const { SourceError } = await import("./http");
  return {
    fetchHnStartups: async () => {
      if (sources.hnFails) throw new SourceError("took too long to answer");
      return [];
    },
  };
});

const prisma = () => db.client!;
const berlin = placeOf(profile.basics);
const filter = (change: object = {}) => startupFilterSchema.parse(change);
const startup = (change: Partial<FoundStartup> = {}): FoundStartup => ({
  source: "HN",
  externalId: "1",
  company: "Acme",
  website: "https://acme.io",
  summary: "Android apps for farmers",
  details: "Acme | Android Engineer | Berlin, Germany\nKotlin, Android. Write to jobs@acme.io or jane at acme dot io.",
  location: "Berlin, Germany",
  remote: false,
  stage: "",
  roles: ["Android Engineer"],
  emails: [],
  links: [],
  postedAt: "2026-10-20T12:00:00Z",
  ...change,
});
const address = (email: string, change: Partial<StartupEmail> = {}): StartupEmail => ({ email, label: "Hiring", from: "https://acme.io/careers", onRequest: false, foundAt: "2026-10-01T00:00:00Z", ...change });
const now = new Date("2026-10-23T12:00:00Z");

beforeEach(async () => {
  await resetDatabase(prisma());
  web.emails = [];
  web.noApplicationsFrom = "";
  web.looked = [];
  sources.yc = [];
  sources.hnFails = false;
});
afterAll(() => prisma().$disconnect());

describe("keeping startups (#222)", () => {
  it("adds new startups, scored, and updates known ones without losing what the user did", async () => {
    expect(await upsertStartups([startup(), startup()], now)).toBe(1);
    const [row] = await prisma().startup.findMany();
    expect(row).toMatchObject({ company: "Acme", status: "NEW", scoredWith: "match@1" });
    expect(row.score).toBeGreaterThan(50);

    await prisma().startup.update({ where: { id: row.id }, data: { status: "SAVED", notes: "Ask about Compose", emails: [address("jobs@acme.io")] } });
    expect(await upsertStartups([startup({ summary: "Now with tractors", website: "" })], now)).toBe(0);
    expect(await getStartup(row.id)).toMatchObject({ summary: "Now with tractors", website: "https://acme.io", status: "SAVED", notes: "Ask about Compose", emails: [{ email: "jobs@acme.io" }] });
  });

  it("leaves out startups removed for good: the post, its site or its name", async () => {
    await upsertStartups([startup()], now);
    const [row] = await prisma().startup.findMany();
    expect(await removeStartup(row.id)).toBe(true);
    expect(await removeStartup(row.id)).toBe(false);
    const blocks = await prisma().startupBlock.findMany();
    expect(blocks.map((block) => block.hash).sort()).toEqual(blockHashes(startup()).sort());
    expect(blocks.every((block) => /^[0-9a-f]{64}$/.test(block.hash))).toBe(true);

    expect(await upsertStartups([startup(), startup({ externalId: "2", company: "Other", website: "https://www.acme.io/jobs" }), startup({ externalId: "3", company: "ACME!", website: "" })], now)).toBe(0);
    expect(await upsertStartups([startup({ externalId: "4", company: "Fresh", website: "https://fresh.io" })], now)).toBe(1);
  });

  it("lists by view, source, match, address, place and words, best or newest first", async () => {
    await upsertStartups(
      [
        startup(),
        startup({ externalId: "2", company: "Remote Co", website: "", location: "REMOTE (EU)", details: "Remote Co | Engineer | REMOTE (EU)", postedAt: "2026-10-22T12:00:00Z" }),
        startup({ source: "YC", externalId: "3", company: "Faraway", website: "", location: "Austin, TX", summary: "Faraway (YC W24) Is Hiring in Austin, TX", details: "", roles: [], postedAt: null }),
        startup({ externalId: "4", company: "Munich Co", website: "", location: "Munich, Germany", details: "Munich Co | Engineer | Munich, Germany", emails: [address("jobs@munich.co")], postedAt: "2026-10-19T12:00:00Z" }),
      ],
      now,
    );
    const names = async (change: object) => (await listStartups(filter(change), berlin)).startups.map((entry) => entry.company);
    expect(await names({})).toEqual(["Acme", "Munich Co", "Remote Co"]);
    expect(await names({ sort: "newest" })).toEqual(["Remote Co", "Acme", "Munich Co"]);
    expect(await names({ place: "any" })).toEqual(["Acme", "Munich Co", "Remote Co", "Faraway"]);
    expect(await names({ place: "city" })).toEqual(["Acme"]);
    expect(await names({ place: "country" })).toEqual(["Acme", "Munich Co", "Remote Co"]);
    expect(await names({ place: "remote" })).toEqual(["Remote Co"]);
    expect(await names({ source: "YC", place: "any" })).toEqual(["Faraway"]);
    expect(await names({ withEmail: true })).toEqual(["Munich Co"]);
    expect(await names({ q: "remote co" })).toEqual(["Remote Co"]);
    expect(await names({ minScore: 70 })).toEqual(["Acme"]);

    const [faraway] = (await listStartups(filter({ source: "YC", place: "any" }), berlin)).startups;
    await updateStartup(faraway.id, { status: "DISMISSED", notes: "Too far" });
    const list = await listStartups(filter({ status: "DISMISSED", place: "any" }), berlin, { limit: 1 });
    expect(list).toMatchObject({ total: 1, counts: { NEW: 3, SAVED: 0, CONTACTED: 0, DISMISSED: 1 } });
    expect(list.startups[0].notes).toBe("Too far");
    expect(await updateStartup("missing", { status: "SAVED" })).toBeNull();
  });

  it("counts a startup as contacted once its application went out", async () => {
    await upsertStartups([startup(), startup({ externalId: "2", company: "Two", website: "" })], now);
    const [one, two] = await prisma().startup.findMany({ orderBy: { externalId: "asc" } });
    const sent = await prisma().application.create({ data: { title: "Android · Acme", status: "SENT" } });
    const draft = await prisma().application.create({ data: { title: "Two" } });
    await prisma().startup.update({ where: { id: one.id }, data: { applicationId: sent.id } });
    await prisma().startup.update({ where: { id: two.id }, data: { applicationId: draft.id } });
    expect(await markSentAsContacted()).toBe(1);
    expect((await getStartup(one.id))?.status).toBe("CONTACTED");
    expect((await getStartup(two.id))?.status).toBe("NEW");
    // Deleting the application keeps the startup, unlinked.
    await prisma().application.delete({ where: { id: sent.id } });
    expect((await getStartup(one.id))?.applicationId).toBeNull();
  });

  it("looks on a startup's site for its addresses, and for people's only when asked", async () => {
    await upsertStartups([startup()], now);
    const [row] = await prisma().startup.findMany();
    web.emails = [address("jobs@acme.io")];
    const looked = await lookUpStartup(row.id, { now });
    expect(looked).toMatchObject({ emails: [{ email: "jobs@acme.io" }], emailsCheckedAt: now.toISOString(), peopleCheckedAt: null });
    expect(looked?.reasons).toContain("Publishes an address for applications");

    web.emails = [address("jane@acme.io", { label: "Person", onRequest: true })];
    web.noApplicationsFrom = "“No unsolicited applications.” (acme.io/careers)";
    expect(await lookUpStartup(row.id, { people: true, now })).toMatchObject({
      emails: [{ email: "jobs@acme.io" }, { email: "jane@acme.io" }],
      peopleCheckedAt: now.toISOString(),
      noApplicationsFrom: "“No unsolicited applications.” (acme.io/careers)",
    });
    expect(await lookUpStartup("missing")).toBeNull();
    await prisma().startup.update({ where: { id: row.id }, data: { website: "" } });
    web.looked = [];
    await lookUpStartup(row.id);
    expect(web.looked).toEqual([]);
  });

  it("removes stale untouched startups and people's addresses nobody used", async () => {
    await upsertStartups(
      [startup(), startup({ externalId: "2", company: "Kept", website: "" }), startup({ externalId: "3", company: "Linked", website: "" }), startup({ externalId: "4", company: "Fresh", website: "" })],
      new Date("2026-08-01T00:00:00Z"),
    );
    await upsertStartups([startup({ externalId: "4", company: "Fresh", website: "" })], now);
    const rows = Object.fromEntries((await prisma().startup.findMany()).map((row) => [row.company, row]));
    await prisma().startup.update({ where: { id: rows.Kept.id }, data: { status: "SAVED", emails: [address("jane@kept.io", { label: "Person", onRequest: true }), address("jobs@kept.io")], peopleCheckedAt: now } });
    const application = await prisma().application.create({ data: { title: "Linked" } });
    await prisma().startup.update({ where: { id: rows.Linked.id }, data: { applicationId: application.id } });

    expect(await sweepStartups(now)).toEqual({ removed: 1, addressesDropped: 1 });
    expect((await prisma().startup.findMany({ orderBy: { company: "asc" } })).map((row) => row.company)).toEqual(["Fresh", "Kept", "Linked"]);
    expect(await getStartup(rows.Kept.id)).toMatchObject({ emails: [{ email: "jobs@kept.io" }], peopleCheckedAt: null });
  });

  it("scores again after the profile changed", async () => {
    await upsertStartups([startup()], now);
    profile.skills = [];
    await rescoreStartups(now);
    const [row] = await prisma().startup.findMany();
    expect(row.reasons).not.toContainEqual(expect.stringMatching(/skills/));
    profile.skills = [
      { id: "1", name: "Android" },
      { id: "2", name: "Kotlin" },
    ];
  });

  it("hands New application the startup's text without any address", async () => {
    await upsertStartups([startup(), startup({ source: "YC", externalId: "9", company: "Yc", summary: "Yc (YC W24) Is Hiring", details: "", roles: ["Founding Engineer"] })], now);
    const [hn, yc] = await prisma().startup.findMany({ orderBy: { externalId: "asc" } });
    const text = startupPostingText((await getStartup(hn.id))!);
    expect(text).toContain("Kotlin, Android.");
    expect(text).toContain("Location: Berlin, Germany");
    expect(text).not.toMatch(/jobs@|jane at/);
    expect(startupPostingText((await getStartup(yc.id))!)).toBe("Yc (YC W24) Is Hiring\n\nYc (YC W24) Is Hiring\n\nLocation: Berlin, Germany\n\nRole: Founding Engineer");
  });
});

describe("refreshing startups (#222)", () => {
  it("keeps what both sources found, says which failed, and looks up the best new sites", async () => {
    sources.yc = [startup({ source: "YC", externalId: "1" }), startup({ source: "YC", externalId: "2", company: "No site", website: "" })];
    sources.hnFails = true;
    web.emails = [address("jobs@acme.io")];
    const steps: string[] = [];
    const result = await refreshStartups(async (name) => void steps.push(name), new AbortController().signal, now);
    expect(result).toEqual({
      at: now.toISOString(),
      added: 2,
      sources: [
        { source: "YC", found: 2, error: null },
        { source: "HN", found: 0, error: "Hacker News took too long to answer" },
      ],
      emailsFound: 1,
    });
    expect(steps).toEqual(["Asking Y Combinator and Hacker News", "Scoring 2 startups against your profile", "Looking for application addresses on their own sites"]);
    expect(web.looked).toEqual(["https://acme.io"]);
    expect((await loadSettings()).startupsLastRefresh).toEqual(result);

    // Checked sites aren't read again on the next refresh.
    web.looked = [];
    await refreshStartupsJob.run({}, { step: async () => {}, signal: new AbortController().signal } as never);
    expect(web.looked).toEqual([]);
  });
});
