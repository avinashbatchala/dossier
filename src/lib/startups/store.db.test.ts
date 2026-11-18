import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { loadSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

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
  saveStartupScore,
  startupPosting,
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
// Other profiles (E24-6) by id; any other id is the first's.
const others = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/profile-data", () => ({ loadProfile: async (id?: string) => (id && others.get(id)) ?? profile }));
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
    expect(await names({})).toEqual(["Acme", "Munich Co", "Remote Co", "Faraway"]);
    expect(await names({ sort: "newest" })).toEqual(["Remote Co", "Acme", "Munich Co", "Faraway"]);
    expect(await names({ place: "city" })).toEqual(["Acme"]);
    expect(await names({ place: "country" })).toEqual(["Acme", "Munich Co"]);
    expect(await names({ place: "remote" })).toEqual(["Remote Co"]);
    expect(await names({ source: "YC" })).toEqual(["Faraway"]);
    expect(await names({ withEmail: true })).toEqual(["Munich Co"]);
    expect(await names({ q: "remote co" })).toEqual(["Remote Co"]);
    // Where it hires from, for the profile's country (E32-4).
    expect((await listStartups(filter({}), berlin)).startups.map((entry) => [entry.company, entry.hiresFrom])).toEqual([
      ["Acme", "hires from Germany"],
      ["Munich Co", "hires from Germany"],
      ["Remote Co", "hires from Germany"],
      ["Faraway", ""],
    ]);

    // The tabs (PL1): Hiring now is every one not dismissed; Applied for, contacted or with an application.
    const [faraway] = (await listStartups(filter({ source: "YC" }), berlin)).startups;
    await updateStartup(faraway.id, { status: "DISMISSED", notes: "Too far" });
    const list = await listStartups(filter({ view: "DISMISSED" }), berlin, { limit: 1 });
    expect(list).toMatchObject({ total: 1, counts: { HIRING: 3, NEW: 3, SAVED: 0, APPLIED: 0, DISMISSED: 1 } });
    const [acme] = (await listStartups(filter({ q: "acme" }), berlin)).startups;
    await prisma().startup.update({ where: { id: acme.id }, data: { applicationId: (await prisma().application.create({ data: { title: "Acme" } })).id } });
    expect(await names({ view: "APPLIED" })).toEqual(["Acme"]);
    expect(await names({ view: "HIRING" })).toEqual(["Acme", "Munich Co", "Remote Co"]);
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
    expect(looked?.reasons).toContainEqual({ text: "Publishes an address for applications", good: true });

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

  it("removes job seekers' posts nobody touched (public #144)", async () => {
    const seeker = (externalId: string) => startup({ externalId, company: "I’m a backend engineer", website: "", details: "I’m a backend engineer | Software Engineer | Remote\nLooking for my next role." });
    await upsertStartups([startup(), seeker("2"), seeker("3")], now);
    const saved = (await prisma().startup.findFirstOrThrow({ where: { externalId: "3" } })).id;
    await prisma().startup.update({ where: { id: saved }, data: { status: "SAVED" } });
    expect(await sweepStartups(now)).toEqual({ removed: 1, addressesDropped: 0 });
    expect((await prisma().startup.findMany({ orderBy: { externalId: "asc" } })).map((row) => row.externalId)).toEqual(["1", "3"]);
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

  it("scores against every profile and keeps the best one's (E24-6)", async () => {
    const ios = await prisma().profile.create({ data: { name: "iOS", sort: 1 } });
    others.set(ios.id, { ...profile, basics: { ...profile.basics, headline: "iOS engineer" }, skills: [{ id: "3", name: "Swift" }] });
    try {
      const swift = startup({ externalId: "2", company: "Swifty", website: "https://swifty.io", summary: "Swift apps for bakers", details: "Swifty | iOS Engineer | Berlin\nSwift.", roles: ["iOS Engineer"] });
      await upsertStartups([startup(), swift], now);
      const rows = await prisma().startup.findMany({ orderBy: { externalId: "asc" } });
      expect(rows.map((row) => [row.company, row.profileId])).toEqual([
        ["Acme", TEST_PROFILE_ID],
        ["Swifty", ios.id],
      ]);
      expect(rows[1].reasons).toContainEqual(expect.stringMatching(/Swift/));
      expect((await getStartup(rows[1].id))?.profileId).toBe(ios.id);

      // Without that profile, the first's is the best again.
      others.delete(ios.id);
      await prisma().profile.delete({ where: { id: ios.id } });
      expect((await prisma().startup.findUniqueOrThrow({ where: { id: rows[1].id } })).profileId).toBeNull();
      await rescoreStartups(now);
      expect((await prisma().startup.findUniqueOrThrow({ where: { id: rows[1].id } })).profileId).toBe(TEST_PROFILE_ID);
    } finally {
      others.clear();
    }
  });

  it("keeps the scoring model's score through refreshes and site look-ups, and scores the post without addresses (#524)", async () => {
    await upsertStartups([startup()], now);
    const [row] = await prisma().startup.findMany();
    expect(await getStartup(row.id)).toMatchObject({ aiScored: false, reasons: expect.arrayContaining([{ text: expect.any(String), good: true }]) });
    const posting = await startupPosting(row.id);
    expect(posting).toMatchObject({ title: "Android Engineer", company: "Acme", place: "Berlin, Germany", remote: false });
    expect(posting!.description).toContain("Kotlin, Android.");
    expect(posting!.description).not.toMatch(/jobs@|jane at/);

    const reasons = [
      { text: "Builds Android apps in Kotlin", good: true },
      { text: "Wants fluent German", good: false },
    ];
    expect(await saveStartupScore(row.id, { score: 81.4, reasons: ["Builds Android apps in Kotlin"], redFlags: ["Wants fluent German"] }, "score-posting@3", TEST_PROFILE_ID)).toMatchObject({
      score: 81,
      aiScored: true,
      reasons,
    });
    await upsertStartups([startup({ summary: "Now with tractors" })], now);
    await rescoreStartups(now);
    await lookUpStartup(row.id, { now });
    expect(await getStartup(row.id)).toMatchObject({ summary: "Now with tractors", score: 81, aiScored: true, reasons });
    expect((await prisma().startup.findUniqueOrThrow({ where: { id: row.id } })).scoredWith).toBe("score-posting@3");
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
