import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { encryptApiKey } from "@/lib/ai/api-key";
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, EXPORT_SCHEMA_VERSIONS, exportSchema, INSTALL_SETTINGS, SECRET_SETTINGS, type DossierExport } from "@/lib/data-export";
import { encryptSecret, JOB_SOURCE_KEY } from "@/lib/secrets";

// Restoring from an export file (E10-6, SET-10): everything is replaced in
// one transaction, so a failure changes nothing. The caller backs up the
// current data first.

export type ImportSummary = { applications: number; roles: number; skills: number; themes: number; notes: number };

/** Reads an export file, or says in plain words why it can't be used. */
export function parseExport(text: string): { ok: true; data: DossierExport } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't a Dossier export: it isn't JSON." };
  }
  const header = json as { format?: unknown; schemaVersion?: unknown };
  if (typeof json !== "object" || json === null || header.format !== EXPORT_FORMAT) {
    return { ok: false, error: "That file isn't a Dossier export." };
  }
  if (typeof header.schemaVersion !== "number") return { ok: false, error: "That export has no schema version, so it can't be read." };
  if (header.schemaVersion > EXPORT_SCHEMA_VERSION) {
    return { ok: false, error: `That export comes from a newer version of Dossier (schema ${header.schemaVersion}). Update this server first.` };
  }
  if (!EXPORT_SCHEMA_VERSIONS.includes(header.schemaVersion)) {
    return { ok: false, error: `That export's schema version (${header.schemaVersion}) isn't one this version of Dossier can read.` };
  }
  const parsed = exportSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `That export is damaged or incomplete (${issue.path.join(".") || "the file"}: ${issue.message}).` };
  }
  return { ok: true, data: parsed.data };
}

/** What a file holds, for "replace this with that". */
export function summarizeExport(data: DossierExport): ImportSummary {
  return {
    applications: data.applications.length,
    roles: data.profile.experience.length,
    skills: data.profile.skills.length,
    themes: data.themes.length,
    notes: data.applications.reduce((count, application) => count + application.notes.length, 0),
  };
}

/** What the database holds now, the same way. */
export async function currentSummary(db: PrismaClient): Promise<ImportSummary> {
  const [applications, roles, skills, themes, notes] = await Promise.all([
    db.application.count(),
    db.experience.count(),
    db.skill.count(),
    db.theme.count({ where: { builtIn: false } }),
    db.note.count(),
  ]);
  return { applications, roles, skills, themes, notes };
}

/** A copy of `value` without `keys`. */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}

const json = (value: unknown) => (value === null || value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue));

/**
 * Replaces all user data with the export's, in one transaction. Each saved
 * key (the AI provider's, the job sources') stays as it is unless the file
 * carries one, which is then encrypted with this server's secret. The
 * install's own settings (the usage ping's) stay as they are.
 */
export async function importExport(db: PrismaClient, data: DossierExport): Promise<void> {
  const { profile, themes, settings, applications, postings, searches, apiKey, jobSourceKeys } = data;
  const fromFile: Record<string, string | null> = {
    apiKeyEnc: apiKey ? encryptApiKey(apiKey) : null,
    jsearchKeyEnc: jobSourceKeys?.jsearch ? encryptSecret(JOB_SOURCE_KEY, jobSourceKeys.jsearch) : null,
    adzunaKeyEnc: jobSourceKeys?.adzuna ? encryptSecret(JOB_SOURCE_KEY, jobSourceKeys.adzuna) : null,
  };
  const keptKeys = [...SECRET_SETTINGS.filter((key) => !fromFile[key]), ...INSTALL_SETTINGS];
  await db.$transaction(
    async (tx) => {
      // Out with the old. Applications take their history, documents, chat,
      // notes and jobs along; the other jobs (a resume import, postings read
      // for applications never created) hold the old data too.
      await tx.job.deleteMany();
      await tx.posting.deleteMany();
      await tx.postingSearch.deleteMany();
      // Mail from Gmail belongs to the applications being replaced; the next check fetches what's still relevant.
      await tx.emailMessage.deleteMany();
      await tx.application.deleteMany();
      await tx.experience.deleteMany();
      await tx.skill.deleteMany();
      await Promise.all([
        tx.profileField.deleteMany(),
        tx.language.deleteMany(),
        tx.education.deleteMany(),
        tx.reference.deleteMany(),
        tx.theme.deleteMany({ where: { builtIn: false } }),
        tx.setting.deleteMany({ where: { key: { notIn: keptKeys } } }),
      ]);

      // In with the new.
      await tx.profileField.createMany({ data: profile.fields });
      await tx.skill.createMany({ data: profile.skills });
      await tx.language.createMany({ data: profile.languages });
      await tx.experience.createMany({ data: profile.experience.map((entry) => omit(entry, "skillIds")) });
      await tx.experienceSkill.createMany({
        data: profile.experience.flatMap((entry) => entry.skillIds.map((skillId) => ({ experienceId: entry.id, skillId }))),
        skipDuplicates: true,
      });
      await tx.education.createMany({ data: profile.education });
      await tx.reference.createMany({ data: profile.references });
      await tx.theme.createMany({ data: themes.map((theme) => ({ ...theme, builtIn: false })) });
      await tx.setting.createMany({ data: settings.filter((setting) => !SECRET_SETTINGS.includes(setting.key) && !INSTALL_SETTINGS.includes(setting.key)) });
      for (const [key, value] of Object.entries(fromFile)) if (value) await tx.setting.create({ data: { key, value } });

      const themeIds = new Set((await tx.theme.findMany({ select: { id: true } })).map((theme) => theme.id));
      await tx.application.createMany({
        data: applications.map((application) => ({
          ...omit(application, "events", "documents", "messages", "notes"),
          extracted: json(application.extracted),
          match: json(application.match),
        })),
      });
      await tx.statusEvent.createMany({
        data: applications.flatMap((application) => application.events.map((event) => ({ ...event, applicationId: application.id }))),
      });
      await tx.document.createMany({
        data: applications.flatMap((application) =>
          application.documents.map((document) => ({
            ...omit(document, "versions"),
            applicationId: application.id,
            units: (document.units ?? []) as Prisma.InputJsonValue,
            trimmed: json(document.trimmed),
            // A theme that isn't here falls back to the base theme.
            themeId: document.themeId && themeIds.has(document.themeId) ? document.themeId : null,
          })),
        ),
      });
      await tx.documentVersion.createMany({
        data: applications.flatMap((application) =>
          application.documents.flatMap((document) =>
            (document.versions ?? []).map((version) => ({ ...version, documentId: document.id, units: version.units as Prisma.InputJsonValue })),
          ),
        ),
      });
      await tx.chatMessage.createMany({
        data: applications.flatMap((application) =>
          application.messages.map((message) => ({ ...message, applicationId: application.id, edits: json(message.edits) })),
        ),
      });
      await tx.note.createMany({
        data: applications.flatMap((application) => application.notes.map((note) => ({ ...note, applicationId: application.id }))),
      });
      // A posting's application that isn't in the file leaves it unlinked.
      const applicationIds = new Set(applications.map((application) => application.id));
      await tx.posting.createMany({
        data: postings.map((posting) => ({ ...posting, applicationId: posting.applicationId && applicationIds.has(posting.applicationId) ? posting.applicationId : null })),
      });
      await tx.postingSearch.createMany({
        data: searches.map((search) => ({ ...search, query: (search.query ?? {}) as Prisma.InputJsonValue, postings: (search.postings ?? []) as Prisma.InputJsonValue })),
      });
    },
    // A big export takes longer than the default five seconds.
    { timeout: 120_000, maxWait: 10_000 },
  );
}
