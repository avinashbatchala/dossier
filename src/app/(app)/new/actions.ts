"use server";

import { createHash } from "node:crypto";

import { z } from "zod";

import { ApplicationStatus, JobStatus, Tone } from "@/generated/prisma/enums";
import { DOCUMENTS_TO_WRITE } from "@/lib/settings";
import { action, ActionError } from "@/lib/action";
import { createDraftApplication, createSentApplication } from "@/lib/application-create";
import { matchSchema } from "@/lib/application-data";
import { handOffPastedPosting } from "@/lib/connector/handoff";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { scorePastedPostingJob } from "@/lib/jobs/score-posting";
import { startJob } from "@/lib/jobs/runner";
import { writeApplicationJob, writeApplicationJobKey } from "@/lib/jobs/write-application";
import { fetchPosting } from "@/lib/posting-fetch";
import { companyKey } from "@/lib/dedupe";
import { PASTED_SOURCE } from "@/lib/job-search/sources";
import { saveScore } from "@/lib/posting-scores";
import { savePosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { findOrCreateSkill } from "@/lib/profile-entries";
import { levelsProblem, listProfiles, profileIdOr } from "@/lib/profiles";

/** "Read the posting →": starts reading it in the background and returns the job's id (E7-2). */
export const startReadingPosting = action(
  z.object({
    posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000),
    /** The profile it's made from (E24-6): its match, documents and application are that profile's. */
    profileId: z.string().min(1).optional(),
    /** The Positions posting it was started from (E14-8), whose kept score answers How you match (E25-7). */
    postingId: z.string().min(1).max(100).nullish(),
  }),
  async ({ posting, profileId, postingId }) => {
    const stored = postingId ? await prisma.posting.findUnique({ where: { id: postingId }, select: { source: true, externalId: true } }) : null;
    return startJob(readPostingJob, { posting, profileId: await profileIdOr(profileId), ...(stored ? { scored: stored } : {}) });
  },
);

/**
 * "Write it with Claude →" (#221, the connector on and no AI model of
 * Dossier's own): keeps the posting for the connector to read and gives the
 * claude.ai chat to open, where Claude writes the application on the user's
 * own Claude plan.
 */
export const handOffToClaude = action(
  z.object({
    posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000),
    postingUrl: z.string().trim().max(2000),
    /** The profile chosen (E24-6): Claude is told its name when there are several. */
    profileId: z.string().min(1).optional(),
  }),
  async ({ posting, postingUrl, profileId }) => {
    const profiles = await listProfiles();
    const profile = profiles.length > 1 ? (profiles.find((entry) => entry.id === profileId) ?? profiles[0]).name : "";
    return { url: await handOffPastedPosting({ text: posting, url: /^https?:\/\//i.test(postingUrl) ? postingUrl : "", profile }) };
  },
);

const detailsSchema = z.object({
  title: z.string().trim().max(300),
  company: z.string().trim().max(200),
  role: z.string().trim().max(200),
  location: z.string().trim().max(200),
  mode: z.string().trim().max(200),
  salary: z.string().trim().max(200),
  deadline: z.union([z.literal(""), z.iso.date()]),
});

/** "Score it" in the review (public issue 66): how well the posting fits, with reasons, in the background. */
export const startScoringPosting = action(
  z.object({
    posting: z.string().trim().min(1).max(100_000),
    details: detailsSchema.pick({ title: true, company: true, location: true, mode: true, salary: true }),
    /** The profile chosen for the application (E24-6). */
    profileId: z.string().min(1).optional(),
  }),
  async ({ posting, details, profileId }) => {
    // Scoring waits until the profile's levels are chosen (E24-3).
    const waiting = await levelsProblem(profileId);
    if (waiting) throw new ActionError(`${waiting.message} Choose them in Profile → Jobs it's for.`);
    return startJob(scorePastedPostingJob, { posting, ...details, profileId: await profileIdOr(profileId) });
  },
);

const STALE = "That reading of the posting is no longer available. Read the posting again.";

/** The finished job that read the posting, with its input and result. */
async function finishedReading(id: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.type !== readPostingJob.type || job.status !== JobStatus.DONE) throw new ActionError(STALE);
  return { input: readPostingJob.input.parse(job.input), result: readPostingJob.result.parse(job.result) };
}

/**
 * "Write resume and letter" (E31-4, decided 17 November 2026): makes the
 * Draft application at once, from the reading and the details as edited,
 * and writes its documents into it on the server. Returns the application's
 * id, to open it; a second click returns the same one.
 */
export const startWritingApplication = action(
  z.object({
    readJobId: z.string().min(1),
    details: detailsSchema,
    match: matchSchema,
    tone: z.enum(Tone),
    note: z.string().trim().max(2000),
    write: z.enum(DOCUMENTS_TO_WRITE).default("both"),
    /** The documents' language; "" for Settings', else the posting's. */
    language: z.string().trim().max(60).default(""),
    /** "I don't have this" before writing (E30-5). */
    knownGaps: z.array(z.string().max(500)).max(100).default([]),
    postingUrl: z.string().max(2000),
    /** The Find jobs posting it was started from (E14-8). */
    postingId: z.string().min(1).max(100).nullish(),
    /** The startup it was started from on Startups (#222). */
    startupId: z.string().min(1).max(100).nullish(),
  }),
  async ({ readJobId, details, match, tone, note, write, language, knownGaps, postingUrl, postingId, startupId }) => {
    const reading = await finishedReading(readJobId);
    const { id, isNew } = await createDraftApplication({
      reading: { posting: reading.input.posting, ...reading.result },
      readJobId,
      match,
      details,
      postingUrl: postingLink(postingUrl),
      tone,
      note,
      language,
      knownGaps,
      postingId: postingId ?? null,
      startupId: startupId ?? null,
      // Made from the profile it was read with (E24-6).
      profileId: reading.input.profileId,
    });
    if (isNew) await startJob(writeApplicationJob, { applicationId: id, write }, { key: writeApplicationJobKey(id), applicationId: id });
    return id;
  },
);

/**
 * "Add to profile" on a gap before writing (E30-5 on New application): the
 * skill into the profile it's read with, linked to the role it was used in,
 * with what was done there as a line of that role.
 */
export const addGapSkill = action(
  z.object({
    profileId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    experienceId: z.string().min(1).nullish(),
    did: z.string().trim().max(500).optional(),
  }),
  async ({ profileId: asked, name, experienceId, did }) => {
    const profileId = await profileIdOr(asked);
    const role = experienceId ? await prisma.experience.findFirst({ where: { id: experienceId, profileId }, select: { id: true, company: true, role: true, bullets: true } }) : null;
    if (experienceId && !role) throw new ActionError("That role is no longer in your profile. Reload the page to see what's there now.");
    const { skill } = await findOrCreateSkill(profileId, name);
    if (role) {
      await prisma.experienceSkill.upsert({ where: { experienceId_skillId: { experienceId: role.id, skillId: skill.id } }, create: { experienceId: role.id, skillId: skill.id }, update: {} });
      if (did) await prisma.experience.update({ where: { id: role.id }, data: { bullets: role.bullets.trim() ? `${role.bullets.trimEnd()}\n${did}` : did } });
    }
    return { name: skill.name, where: role ? role.company.trim() || role.role.trim() : "", experienceId: role?.id ?? null };
  },
);

/**
 * "Not applying? Save it for later" (E31-3, decided 17 November 2026): the
 * posting goes into Positions under Saved, with the source "Pasted", and
 * its score from the reading. One started from Positions is saved there.
 */
export const savePostingForLater = action(
  z.object({
    posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000),
    postingUrl: z.string().max(2000),
    details: detailsSchema.pick({ title: true, company: true, role: true, location: true, mode: true, salary: true }),
    /** The reading, for its score against the profile. */
    readJobId: z.string().min(1).nullish(),
    postingId: z.string().min(1).max(100).nullish(),
  }),
  async ({ posting, postingUrl, details, readJobId, postingId }) => {
    if (postingId) {
      const { count } = await prisma.posting.updateMany({ where: { id: postingId }, data: { savedAt: new Date(), dismissedAt: null, archivedAt: null, removedAt: null } });
      if (count > 0) return postingId;
    }
    let url = "";
    try {
      url = postingLink(postingUrl);
    } catch {
      // A link that isn't one stays out; the text is what's saved.
    }
    const found = {
      source: PASTED_SOURCE,
      // The same text saved twice is one posting.
      externalId: createHash("sha256").update(posting.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 32),
      title: details.role || details.title,
      company: details.company,
      place: details.location,
      remote: /\b(remote|home ?office)\b/i.test(details.mode) ? true : null,
      salary: details.salary,
      postedAt: null,
      url,
      via: "",
      description: posting,
      complete: true,
    };
    const saved = await savePosting(found);
    await prisma.posting.update({ where: { id: saved.id }, data: { matchCompany: companyKey(details.company) } });
    if (readJobId) {
      const reading = await finishedReading(readJobId).catch(() => null);
      if (reading?.result.fit) await saveScore(found, reading.result.fit, reading.result.matchedWith, await profileIdOr(reading.input.profileId));
    }
    return saved.id;
  },
);

/**
 * "Fetch" (E7-8, NEW-9): the posting's text from its link, for the user to
 * check before it's read. The request goes to the job site from the server.
 */
export const fetchPostingText = action(z.object({ link: z.string().max(2000) }), async ({ link }) => {
  const url = postingLink(link);
  if (!url) throw new ActionError("Enter the link to the posting first.");
  const fetched = await fetchPosting(url);
  if (!fetched.ok) throw new ActionError(fetched.error);
  // Shown with a warning when it looks like menus or links (#232): the user checks it either way.
  return { text: fetched.text, url: fetched.url, doubtful: fetched.doubtful };
});

/** A link as typed, with https:// added when it has no scheme; empty stays empty. */
function postingLink(value: string): string {
  const link = value.trim();
  if (!link) return "";
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(link) ? link : `https://${link}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    // Not a link.
  }
  throw new ActionError("The link to the posting doesn't look like a web address. Fix it or leave it empty.");
}

/** The statuses an application sent before Dossier can be added in (public #129). */
const SENT_STATUSES = [
  ApplicationStatus.SENT,
  ApplicationStatus.SCREENING,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.ACCEPTED,
  ApplicationStatus.REJECTED,
  ApplicationStatus.DECLINED,
] as const;

/**
 * "Already sent it?" (public #129): adds an application sent before Dossier,
 * with no documents written, and returns its id. Nothing goes to the AI.
 */
export const addSentApplication = action(
  z.object({
    posting: z.string().trim().max(100_000),
    postingUrl: z.string().max(2000),
    company: z.string().trim().max(200),
    role: z.string().trim().max(200),
    sentOn: z.iso.date("Give the day you sent it."),
    status: z.enum(SENT_STATUSES),
    profileId: z.string().min(1).optional(),
    postingId: z.string().min(1).max(100).nullish(),
    startupId: z.string().min(1).max(100).nullish(),
  }),
  async ({ posting, postingUrl, company, role, sentOn, status, profileId, postingId, startupId }) => {
    if (!company && !role) throw new ActionError("Give the company or the role.");
    // A day ahead allows for time zones east of the server's.
    if (Date.parse(`${sentOn}T00:00:00Z`) > Date.now() + 24 * 60 * 60 * 1000) throw new ActionError("The day you sent it can't be in the future.");
    return createSentApplication({ posting, postingUrl: postingLink(postingUrl), company, role, sentOn, status, profileId, postingId, startupId });
  },
);
