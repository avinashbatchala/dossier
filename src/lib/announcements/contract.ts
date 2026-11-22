import { z } from "zod";

// What the project's backend answers to GET /announcements, as the app reads
// it. api-v1.schema.json next to this file is a copy of the backend's contract,
// as a JSON Schema. The app's reading is looser on purpose, because the API only
// grows: fields it doesn't know are ignored, an unknown severity counts as
// "info", and one item it can't read is skipped. Safe to use in the browser.

export const SEVERITIES = ["info", "important", "security"] as const;
export type Severity = (typeof SEVERITIES)[number];

const TITLE_MAX = 80;
const BODY_MAX = 500;
/** More than any install would ever show, so an answer can't fill the database. */
const MAX_ITEMS = 50;

const isSeverity = (value: string): value is Severity => (SEVERITIES as readonly string[]).includes(value);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);

export const announcementSchema = z.object({
  id: z.string().min(1).max(100),
  severity: z.string().transform((value): Severity => (isSeverity(value) ? value : "info")),
  title: z.string().min(1).max(TITLE_MAX),
  body: z.string().min(1).max(BODY_MAX),
  // A notice stays worth showing without its link, unlike without its range.
  link: z.object({ label: z.string().min(1), url: z.string() }).nullable().catch(null),
  minVersion: version.nullable().default(null),
  maxVersion: version.nullable().default(null),
  publishedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable().default(null),
});
export type Announcement = z.output<typeof announcementSchema>;

const answerSchema = z.object({ announcements: z.array(z.unknown()) });

/** The notices in an answer, skipping those it can't read; null when it isn't the expected shape at all. */
export function parseAnnouncements(answer: unknown): Announcement[] | null {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) return null;
  return parsed.data.announcements.flatMap((item) => {
    const notice = announcementSchema.safeParse(item);
    return notice.success ? [notice.data] : [];
  }).slice(0, MAX_ITEMS);
}

/**
 * What the last answer said, as Settings keeps it. `appVersion` is the version
 * that read it: a later one may read more of the same answer, so it asks again
 * without the ETag rather than get a 304 and keep this.
 */
export const announcementFeedSchema = z.object({
  items: z.array(announcementSchema),
  etag: z.string().nullable(),
  appVersion: z.string(),
  nextCheckAt: z.iso.datetime(),
});
export type AnnouncementFeed = z.output<typeof announcementFeedSchema>;
