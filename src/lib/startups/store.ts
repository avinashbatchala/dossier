import "server-only";

import { createHash } from "node:crypto";

import type { Prisma, Startup } from "@/generated/prisma/client";
import { ApplicationStatus, StartupStatus } from "@/generated/prisma/enums";
import type { ProfileData } from "@/lib/profile";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { listProfiles } from "@/lib/profiles";

import { lookUpSite, rankEmails } from "./emails";
import { matchStartup, MATCH_VERSION, whereText, type StartupFit } from "./match";
import { placeOf, reach, type Place } from "./place";
import { domainOf, headerParts, isJobSeeker, withoutAddresses } from "./text";
import {
  startupEmailSchema,
  startupLinkSchema,
  STARTUP_SOURCES,
  STARTUP_VIEWS,
  type FoundStartup,
  type StartupEmail,
  type StartupFilter,
  type StartupReason,
  type StartupSource,
  type StartupView,
  type StartupViewName,
} from "./types";

// Startups in the database (#222): kept from refresh to refresh with what
// the user did with them (saved, contacted, dismissed, notes), scored
// against the profile, and listed for the screen. Untouched ones go when no
// refresh has found them for a while, and so do people's addresses that
// were looked up but never used.

/** Startups nobody did anything with are removed once no refresh found them for this long. */
const STALE_DAYS = 45;
/** People's own addresses, looked up on request, are dropped after this long unless the user wrote to the startup. */
const PEOPLE_DAYS = 14;
const DAY_MS = 86_400_000;

const strings = (value: Prisma.JsonValue | null): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
const emailsOf = (value: Prisma.JsonValue | null): StartupEmail[] => startupEmailSchema.array().catch([]).parse(value ?? []);
const linksOf = (value: Prisma.JsonValue | null) => startupLinkSchema.array().catch([]).parse(value ?? []);
/** The keyword match keeps its reasons as strings; a scoring model's (#524) are { text, good }. */
const reasonsOf = (value: Prisma.JsonValue | null): StartupReason[] =>
  (Array.isArray(value) ? value : []).flatMap((entry) =>
    typeof entry === "string"
      ? [{ text: entry, good: true }]
      : entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.text === "string"
        ? [{ text: entry.text, good: entry.good !== false }]
        : [],
  );

/**
 * Whether a startup's score is the keyword match's (#524), which every
 * refresh works out again. A score from the scoring model is kept until the
 * user scores it again.
 */
const keywordScored = (scoredWith: string) => scoredWith === "" || scoredWith.startsWith("match@");

function startupView(row: Startup): StartupView {
  return {
    id: row.id,
    source: (STARTUP_SOURCES as readonly string[]).includes(row.source) ? (row.source as StartupSource) : "HN",
    externalId: row.externalId,
    company: row.company,
    website: row.website,
    summary: row.summary,
    details: row.details,
    location: row.location,
    remote: row.remote,
    stage: row.stage,
    roles: strings(row.roles),
    emails: emailsOf(row.emails),
    links: linksOf(row.links),
    postedAt: row.postedAt?.toISOString() ?? null,
    score: row.score,
    reasons: reasonsOf(row.reasons),
    aiScored: !keywordScored(row.scoredWith),
    profileId: row.profileId,
    status: row.status,
    noApplicationsFrom: row.noApplicationsFrom,
    emailsCheckedAt: row.emailsCheckedAt?.toISOString() ?? null,
    peopleCheckedAt: row.peopleCheckedAt?.toISOString() ?? null,
    notes: row.notes,
    applicationId: row.applicationId,
  };
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const folded = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** What "Remove and don't bring back" keeps: hashes of the post, the site's domain and the name, nothing readable. */
export function blockHashes(startup: Pick<FoundStartup, "source" | "externalId" | "website" | "company">): string[] {
  const domain = domainOf(startup.website);
  return [hash(`post:${startup.source}:${startup.externalId}`), ...(domain ? [hash(`site:${domain}`)] : []), ...(folded(startup.company) ? [hash(`name:${folded(startup.company)}`)] : [])];
}

type Scoring = { profiles: { id: string; data: ProfileData }[]; place: Place };

/** The place and every profile to score against (E24-6). */
async function scoring(): Promise<Scoring> {
  const profiles = await Promise.all((await listProfiles()).map(async ({ id }) => ({ id, data: await loadProfile(id) })));
  return { profiles, place: placeOf(profiles[0].data.basics) };
}

/** How well a startup fits the profile it fits best; the first of those that tie. */
function bestFit(startup: Parameters<typeof matchStartup>[0], { profiles, place }: Scoring, now: Date): StartupFit & { profileId: string } {
  let best: (StartupFit & { profileId: string }) | null = null;
  for (const profile of profiles) {
    const fit = matchStartup(startup, profile.data, place, now);
    if (!best || fit.score > best.score) best = { ...fit, profileId: profile.id };
  }
  return best!;
}

/**
 * Keeps what a refresh found: new startups are added (unless removed for
 * good), known ones updated (never their status, notes or the addresses
 * found on their site), and every one is scored. Returns how many were new.
 */
export async function upsertStartups(found: readonly FoundStartup[], now = new Date()): Promise<number> {
  const against = await scoring();
  const blocked = new Set((await prisma.startupBlock.findMany({ select: { hash: true } })).map((row) => row.hash));
  const existing = new Map(
    (await prisma.startup.findMany({ select: { source: true, externalId: true, emails: true, website: true, scoredWith: true } })).map((row) => [`${row.source}:${row.externalId}`, row]),
  );
  const seen = new Set<string>();
  const creates: Prisma.StartupCreateManyInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const startup of found) {
    const key = `${startup.source}:${startup.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const known = existing.get(key);
    if (!known && blockHashes(startup).some((entry) => blocked.has(entry))) continue;
    const emails = rankEmails([...startup.emails, ...emailsOf(known?.emails ?? null)]);
    const fit = bestFit({ ...startup, emails }, against, now);
    const fields = {
      company: startup.company.slice(0, 200),
      website: startup.website || known?.website || "",
      summary: startup.summary.slice(0, 1_000),
      details: startup.details,
      location: startup.location.slice(0, 300),
      remote: startup.remote,
      stage: startup.stage.slice(0, 200),
      roles: startup.roles,
      emails,
      links: startup.links,
      postedAt: startup.postedAt ? new Date(startup.postedAt) : null,
      seenAt: now,
    };
    const scored = { score: fit.score, reasons: fit.reasons, profileId: fit.profileId, scoredWith: MATCH_VERSION };
    if (known) {
      // A score from the scoring model stays (#524).
      const data = keywordScored(known.scoredWith) ? { ...fields, ...scored } : fields;
      updates.push(prisma.startup.update({ where: { source_externalId: { source: startup.source, externalId: startup.externalId } }, data }));
    } else creates.push({ source: startup.source, externalId: startup.externalId, ...fields, ...scored });
  }
  for (let index = 0; index < creates.length; index += 200) {
    await prisma.startup.createMany({ data: creates.slice(index, index + 200) });
  }
  for (let index = 0; index < updates.length; index += 50) {
    await prisma.$transaction(updates.slice(index, index + 50));
  }
  return creates.length;
}

/** Scores every startup again, e.g. after the profile changed. */
export async function rescoreStartups(now = new Date()): Promise<void> {
  const against = await scoring();
  for (const row of await prisma.startup.findMany({ where: { status: { not: StartupStatus.DISMISSED } } })) {
    if (!keywordScored(row.scoredWith)) continue;
    const fit = bestFit(startupView(row), against, now);
    if (fit.score !== row.score || fit.profileId !== row.profileId || JSON.stringify(fit.reasons) !== JSON.stringify(row.reasons)) {
      await prisma.startup.update({ where: { id: row.id }, data: { score: fit.score, reasons: fit.reasons, profileId: fit.profileId, scoredWith: MATCH_VERSION } });
    }
  }
}

/** Startups whose application went out count as contacted. */
export async function markSentAsContacted(): Promise<number> {
  const { count } = await prisma.startup.updateMany({
    where: { status: { in: [StartupStatus.NEW, StartupStatus.SAVED] }, application: { status: { not: ApplicationStatus.DRAFT } } },
    data: { status: StartupStatus.CONTACTED },
  });
  return count;
}

/**
 * Looks on a startup's own site for the addresses it publishes: role
 * addresses, or people's own too when `people` is set. Keeps them, notes a
 * "no unsolicited applications", and scores it again.
 */
export async function lookUpStartup(id: string, { people = false, now = new Date() }: { people?: boolean; now?: Date } = {}): Promise<StartupView | null> {
  const row = await prisma.startup.findUnique({ where: { id } });
  if (!row) return null;
  const view = startupView(row);
  if (!view.website) return view;
  const found = await lookUpSite(view.website, { people, now });
  const emails = rankEmails([...view.emails, ...found.emails]);
  const fit = keywordScored(row.scoredWith) ? bestFit({ ...view, emails }, await scoring(), now) : null;
  return startupView(
    await prisma.startup.update({
      where: { id },
      data: {
        emails,
        noApplicationsFrom: found.noApplicationsFrom || row.noApplicationsFrom,
        ...(people ? { peopleCheckedAt: now } : {}),
        emailsCheckedAt: now,
        ...(fit ? { score: fit.score, reasons: fit.reasons, profileId: fit.profileId, scoredWith: MATCH_VERSION } : {}),
      },
    }),
  );
}

/** A startup as a posting, for the scoring model (#524): its first role, or what it does, and the post's text as New application gets it, without any address. */
export async function startupPosting(id: string) {
  const row = await prisma.startup.findUnique({ where: { id } });
  if (!row) return null;
  const view = startupView(row);
  return {
    title: view.roles[0] || view.summary.slice(0, 200) || view.company,
    company: view.company,
    place: view.location,
    remote: view.remote,
    salary: "",
    description: startupPostingText(view),
  };
}

/** Keeps a scoring model's score (#524): the best profile's, with its reasons and red flags. */
export async function saveStartupScore(
  id: string,
  fit: { score: number; reasons: readonly string[]; redFlags: readonly string[] },
  scoredWith: string,
  profileId: string,
): Promise<StartupView> {
  const reasons = [...fit.reasons.map((text) => ({ text, good: true })), ...fit.redFlags.map((text) => ({ text, good: false }))];
  return startupView(await prisma.startup.update({ where: { id }, data: { score: Math.round(fit.score), reasons, profileId, scoredWith } }));
}

export type StartupList = { startups: StartupView[]; total: number; counts: Record<StartupViewName, number> };

/** Whether a startup hires where the filter asks. */
function inPlace(startup: StartupView, filter: StartupFilter["place"], place: Place): boolean {
  if (filter === "any") return true;
  const where = reach(whereText(startup), place);
  if (filter === "remote") return where.remote && where.remoteOpen !== false;
  if (filter === "city") return where.here === "city";
  return where.here !== null;
}

/** Each tab's startups (PL1): Hiring now is every one not dismissed; Applied for has an application or was contacted. */
const VIEW_WHERE: Record<StartupViewName, Prisma.StartupWhereInput> = {
  HIRING: { status: { not: StartupStatus.DISMISSED } },
  NEW: { status: StartupStatus.NEW },
  SAVED: { status: StartupStatus.SAVED },
  APPLIED: { OR: [{ status: StartupStatus.CONTACTED }, { applicationId: { not: null } }] },
  DISMISSED: { status: StartupStatus.DISMISSED },
};

/** "hires from the Netherlands" when it hires in the profile's country, or remotely open to it. */
function hiresFrom(startup: StartupView, place: Place): string {
  if (!place.countryName) return "";
  const where = reach(whereText(startup), place);
  return where.here !== null || (where.remote && where.remoteOpen === true) ? `hires from ${place.countryName}` : "";
}

/** The startups a tab and filter ask for, best match or newest first, at most `limit`, with each tab's count. */
export async function listStartups(filter: StartupFilter, place: Place, { limit = 100 }: { limit?: number } = {}): Promise<StartupList> {
  await markSentAsContacted();
  const [rows, ...counted] = await Promise.all([
    prisma.startup.findMany({
      where: { ...VIEW_WHERE[filter.view], ...(filter.source ? { source: filter.source } : {}) },
      orderBy: filter.sort === "newest" ? [{ postedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] : [{ score: "desc" }, { postedAt: { sort: "desc", nulls: "last" } }],
    }),
    ...STARTUP_VIEWS.map((view) => prisma.startup.count({ where: VIEW_WHERE[view] })),
  ]);
  const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = rows.map(startupView).filter((startup) => {
    if (filter.withEmail && startup.emails.length === 0) return false;
    if (!inPlace(startup, filter.place, place)) return false;
    if (words.length === 0) return true;
    const text = [startup.company, startup.summary, startup.details, startup.location, startup.stage, ...startup.roles].join(" ").toLowerCase();
    return words.every((word) => text.includes(word));
  });
  const counts = Object.fromEntries(STARTUP_VIEWS.map((view, index) => [view, counted[index]])) as Record<StartupViewName, number>;
  return { startups: matching.slice(0, limit).map((startup) => ({ ...startup, hiresFrom: hiresFrom(startup, place) })), total: matching.length, counts };
}

export async function getStartup(id: string): Promise<StartupView | null> {
  const row = await prisma.startup.findUnique({ where: { id } });
  return row ? startupView(row) : null;
}

/** Saves what the user changed: its status, or the notes. */
export async function updateStartup(id: string, change: { status?: StartupStatus; notes?: string }): Promise<StartupView | null> {
  const data: Prisma.StartupUpdateInput = {};
  if (change.status) data.status = change.status;
  if (change.notes !== undefined) data.notes = change.notes.slice(0, 5_000);
  const { count } = await prisma.startup.updateMany({ where: { id }, data });
  return count > 0 ? getStartup(id) : null;
}

/** "Remove and don't bring back": deletes the startup, keeping only hashes so a refresh leaves it out. An application made from it stays. */
export async function removeStartup(id: string): Promise<boolean> {
  const row = await prisma.startup.findUnique({ where: { id } });
  if (!row) return false;
  const hashes = blockHashes(startupView(row));
  const known = new Set((await prisma.startupBlock.findMany({ where: { hash: { in: hashes } }, select: { hash: true } })).map((block) => block.hash));
  await prisma.$transaction([
    prisma.startupBlock.createMany({ data: hashes.filter((hash) => !known.has(hash)).map((hash) => ({ hash })) }),
    prisma.startup.delete({ where: { id } }),
  ]);
  return true;
}

/**
 * The daily tidy-up: removes startups nobody saved or contacted once no
 * refresh found them for STALE_DAYS, and job seekers' posts nobody touched,
 * and drops people's addresses looked up over PEOPLE_DAYS ago from startups
 * nobody wrote to.
 */
export async function sweepStartups(now = new Date()): Promise<{ removed: number; addressesDropped: number }> {
  const { count: stale } = await prisma.startup.deleteMany({
    where: { status: { in: [StartupStatus.NEW, StartupStatus.DISMISSED] }, applicationId: null, seenAt: { lt: new Date(now.getTime() - STALE_DAYS * DAY_MS) } },
  });
  // Posts by people looking for work, read from the hiring thread before
  // public #144: untouched ones go at once rather than after STALE_DAYS.
  const untouched = await prisma.startup.findMany({ where: { source: "HN", status: StartupStatus.NEW, applicationId: null }, select: { id: true, details: true } });
  const seekers = untouched.filter((row) => isJobSeeker(headerParts(row.details).join(" | "), row.details)).map((row) => row.id);
  const { count: seekersRemoved } = seekers.length > 0 ? await prisma.startup.deleteMany({ where: { id: { in: seekers } } }) : { count: 0 };
  const removed = stale + seekersRemoved;
  const cutoff = now.getTime() - PEOPLE_DAYS * DAY_MS;
  let addressesDropped = 0;
  for (const row of await prisma.startup.findMany({ where: { applicationId: null, peopleCheckedAt: { not: null } }, select: { id: true, emails: true } })) {
    const emails = emailsOf(row.emails);
    const kept = emails.filter((email) => !email.onRequest || !(Date.parse(email.foundAt) < cutoff));
    if (kept.length === emails.length) continue;
    addressesDropped += emails.length - kept.length;
    await prisma.startup.update({ where: { id: row.id }, data: { emails: kept, ...(kept.some((email) => email.onRequest) ? {} : { peopleCheckedAt: null }) } });
  }
  return { removed, addressesDropped };
}

/**
 * What New application starts from (#222): what's known about the startup,
 * as a posting to read. Addresses are left out, written or hidden: they stay
 * in Dossier and never go to the AI.
 */
export function startupPostingText(startup: StartupView): string {
  const lines = [
    startup.source === "YC" ? startup.summary : "",
    startup.details || startup.summary,
    startup.location && `Location: ${startup.location}`,
    startup.roles.length > 0 && startup.source === "YC" ? `Role: ${startup.roles.join(", ")}` : "",
  ];
  return withoutAddresses(lines.filter(Boolean).join("\n\n")).trim();
}
