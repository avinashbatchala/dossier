"use server";

import { z } from "zod";

import { JobStatus, Tone } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { summaryText, tailoringSummary } from "@/lib/ai/tailoring-summary";
import { matchSchema } from "@/lib/application-data";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { startJob } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { fetchPosting } from "@/lib/posting-fetch";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { logServerError } from "@/lib/log";
import { calendarDay } from "@/lib/application-documents";
import { documentLanguage } from "@/lib/document-language";
import { newFrame, withFrame } from "@/lib/letter-frame";
import { describeTrim, fitResumeToOnePage } from "@/lib/one-page";

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
    const link = postingLink(postingUrl);
    const [settings, profile] = await Promise.all([loadSettings(), loadProfile()]);

    const { extracted, extractedWith, matchedWith } = reading.result;
    const language = settings.docLanguage ?? extracted.language ?? "English";
    // E8-11: every part of the letter is a unit. The AI wrote the recipient
    // and greeting; the sender and signature come from the profile, and the
    // date is written now, in the letter's language.
    const letter = withFrame(
      documents.letter,
      newFrame({
        basics: profile.basics,
        company: details.company,
        location: details.location,
        date: calendarDay(),
        dateFormat: settings.dateFormat,
        lang: documentLanguage(language, documents.letter.map((unit) => unit.text).join(" ")).lang,
      }),
    );
    const summary = tailoringSummary({
      profile,
      company: details.company,
      role: details.role,
      match: input.match,
      resume: documents.resume,
      letter: documents.letter,
      tone: input.tone,
      note: input.note,
      references: !settings.includeRefs ? "setting-off" : extracted.asksForReferences ? "included" : "not-asked",
      strict: settings.strict,
      showChanges: settings.showDiff,
    });

    const created = await prisma.$transaction(async (tx) => {
      // Claim the job first: a second click waits here, then finds it taken.
      const { count } = await tx.job.updateMany({ where: { id: writeJobId, key: null }, data: { key: `${CLAIMED}pending` } });
      if (count === 0) {
        const claimed = await tx.job.findUniqueOrThrow({ where: { id: writeJobId }, select: { key: true } });
        if (claimed.key?.startsWith(CLAIMED) && claimed.key !== `${CLAIMED}pending`) return claimed.key.slice(CLAIMED.length);
        throw new ActionError("This application is already being created.");
      }

      const application = await tx.application.create({
        data: {
          title: details.title || [details.role, details.company].filter(Boolean).join(" · ") || "Untitled application",
          company: details.company,
          role: details.role,
          location: details.location,
          mode: details.mode,
          salary: details.salary,
          deadline: details.deadline ? new Date(`${details.deadline}T00:00:00Z`) : null,
          postingUrl: link,
          postingText: reading.input.posting,
          extracted,
          extractedWith,
          match: input.match,
          matchedWith,
          tone: input.tone,
          userNote: input.note,
          language,
          documents: {
            create: [
              // Each starts its history with the first draft (E8-10).
              {
                kind: "RESUME",
                units: documents.resume,
                themeId: settings.baseThemeId,
                writtenWith: documents.resumeWith,
                versions: { create: { units: documents.resume, cause: "WRITTEN" } },
              },
              {
                kind: "COVER_LETTER",
                units: letter,
                themeId: settings.baseThemeId,
                writtenWith: documents.letterWith,
                versions: { create: { units: letter, cause: "WRITTEN" } },
              },
            ],
          },
          messages: { create: { role: "AI", text: summaryText(summary) } },
        },
        select: { id: true },
      });
      const key = `${CLAIMED}${application.id}`;
      await tx.job.updateMany({ where: { id: { in: [writeJobId, input.readJobId] } }, data: { key, applicationId: application.id } });
      // The posting it came from shows it as applied for (E14-8); one already linked keeps its application.
      if (postingId) await tx.posting.updateMany({ where: { id: postingId, applicationId: null }, data: { applicationId: application.id } });
      return { id: application.id, isNew: true };
    });
    if (typeof created === "string") return created;

    // E10-10: once created, a resume that runs over is trimmed to one page,
    // and the opening message says what was cut. A failure here leaves the
    // resume as written rather than failing the application.
    if (settings.onePage) {
      try {
        const { trimmed, fits } = await fitResumeToOnePage(created.id, profile);
        if (trimmed.length > 0 && settings.showDiff) {
          const text = summaryText({ ...summary, list: [...summary.list, ...describeTrim(trimmed, profile, fits)] });
          await prisma.chatMessage.updateMany({ where: { applicationId: created.id, role: "AI", writtenWith: null }, data: { text } });
        }
      } catch (error) {
        logServerError("one-page trimming", error);
      }
    }
    return created.id;
  },
);
