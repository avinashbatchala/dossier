"use server";

import { z } from "zod";

import { JobStatus, Tone } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { createApplicationFromDocuments } from "@/lib/application-create";
import { matchSchema } from "@/lib/application-data";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { startJob } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { fetchPosting } from "@/lib/posting-fetch";
import { prisma } from "@/lib/prisma";

/** "Read the posting →": starts reading it in the background and returns the job's id (E7-2). */
export const startReadingPosting = action(
  z.object({ posting: z.string().trim().min(1, "Paste a job posting first.").max(100_000) }),
  ({ posting }) => startJob(readPostingJob, { posting }),
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

const STALE = "That reading of the posting is no longer available. Read the posting again.";

/** The finished job that read the posting, with its input and result. */
async function finishedReading(id: string) {
  const job = await prisma.job.findUnique({ where: { id } });
  if (!job || job.type !== readPostingJob.type || job.status !== JobStatus.DONE) throw new ActionError(STALE);
  return { input: readPostingJob.input.parse(job.input), result: readPostingJob.result.parse(job.result) };
}

/**
 * "Create application →": writes the tailored documents in the background
 * (E7-6). The details as edited go into the prompts; nothing is saved yet.
 */
export const startWritingDocuments = action(
  z.object({
    readJobId: z.string().min(1),
    details: detailsSchema,
    match: matchSchema,
    tone: z.enum(Tone),
    note: z.string().trim().max(2000),
  }),
  async ({ readJobId, details, match, tone, note }) => {
    const reading = await finishedReading(readJobId);
    const orNull = (value: string) => value || null;
    const extracted = {
      ...reading.result.extracted,
      title: orNull(details.title),
      company: orNull(details.company),
      role: orNull(details.role),
      location: orNull(details.location),
      mode: orNull(details.mode),
      salary: orNull(details.salary),
      deadline: orNull(details.deadline),
    };
    return startJob(writeDocumentsJob, { readJobId, posting: reading.input.posting, extracted, match, tone, note });
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
  return { text: fetched.text, url: fetched.url };
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

/** A write-documents job's key once an application was made from it: "application:<id>". */
const CLAIMED = "application:";

/**
 * Creates the application from the finished documents job (E7-6): the Draft
 * application, its resume and cover letter in the base theme, and the first
 * chat message, in one transaction. Creating twice from the same job returns
 * the application that already exists.
 */
export const createApplication = action(
  z.object({
    writeJobId: z.string().min(1),
    details: detailsSchema,
    postingUrl: z.string().max(2000),
    /** The Find jobs posting it was started from (E14-8). */
    postingId: z.string().min(1).max(100).nullish(),
  }),
  async ({ writeJobId, details, postingUrl, postingId }) => {
    const job = await prisma.job.findUnique({ where: { id: writeJobId } });
    if (!job || job.type !== writeDocumentsJob.type || job.status !== JobStatus.DONE) {
      throw new ActionError("Those documents aren't ready. Try creating the application again.");
    }
    if (job.key?.startsWith(CLAIMED)) return job.key.slice(CLAIMED.length);

    const input = writeDocumentsJob.input.parse(job.input);
    const documents = writeDocumentsJob.result.parse(job.result);
    const reading = await finishedReading(input.readJobId);
    return createApplicationFromDocuments({
      reading: { posting: reading.input.posting, ...reading.result },
      documents,
      match: input.match,
      details,
      postingUrl: postingLink(postingUrl),
      tone: input.tone,
      note: input.note,
      claim: { kind: "manual", writeJobId, readJobId: input.readJobId, postingId: postingId ?? null },
    });
  },
);
