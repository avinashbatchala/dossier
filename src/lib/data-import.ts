import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { encryptApiKey } from "@/lib/ai/api-key";
import { agentSearchInputSchema, legacyAgentQuery, MAX_AGENT_SEARCHES } from "@/lib/agent/search";
import { lockAgentSearches } from "@/lib/agent/searches";
import { ActionError } from "@/lib/action";
import { EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, EXPORT_SCHEMA_VERSIONS, exportSchema, INSTALL_SETTINGS, SECRET_SETTINGS, type DossierExport } from "@/lib/data-export";
import { moveJobSettings } from "@/lib/job-search/config";
import { moveAgentFinds } from "@/lib/agent/move-in";
import { builtInPortal } from "@/lib/portals/built-in";
import { parsePortalConfig } from "@/lib/portals/format";
import { loadInstalledPortals } from "@/lib/portals/installed";
import { fillMatchKeys, movePastSearches } from "@/lib/library";
import { isOwnBasic } from "@/lib/profile";
import { PROFILE_SETTING_KEYS } from "@/lib/profile-settings";
import { DEFAULT_PROFILE_NAME } from "@/lib/profiles";
import { encryptSecret, JOB_SOURCE_KEY, NOTIFICATION_SECRET } from "@/lib/secrets";
import { newWebhookSecret } from "@/lib/notifications/store";

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
/** A JSON list for a column that can't be null (#222): anything else reads as empty. */
const jsonList = (value: unknown) => (Array.isArray(value) ? value : []) as Prisma.InputJsonValue;

/**
 * Replaces all user data with the export's, in one transaction. Each saved
 * key (the AI provider's, the job sources') stays as it is unless the file
 * carries one, which is then encrypted with this server's secret; the
 * TypeSafe key, which exports never carry, always stays. The install's own
 * settings (the usage ping's) stay as they are.
 */
export async function importExport(db: PrismaClient, data: DossierExport): Promise<void> {
  const { profile, themes, settings, applications, postings, searches, agentCandidates, startups, startupBlocks, apiKey, jobSourceKeys, portalKeys } = data;
  const portalKeysEnc = Object.fromEntries(
    Object.entries(portalKeys ?? {}).map(([portal, fields]) => [portal, Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, encryptSecret(JOB_SOURCE_KEY, value)]))]),
  );
  const fromFile: Record<string, string | null> = {
    apiKeyEnc: apiKey ? encryptApiKey(apiKey) : null,
    // Before version 12, one key per source: moved into the portals' shape below (moveJobSettings).
    jsearchKeyEnc: jobSourceKeys?.jsearch ? encryptSecret(JOB_SOURCE_KEY, jobSourceKeys.jsearch) : null,
    adzunaKeyEnc: jobSourceKeys?.adzuna ? encryptSecret(JOB_SOURCE_KEY, jobSourceKeys.adzuna) : null,
    portalKeysEnc: Object.keys(portalKeysEnc).length > 0 ? JSON.stringify(portalKeysEnc) : null,
  };
  const keptKeys = [...SECRET_SETTINGS.filter((key) => !fromFile[key]), ...INSTALL_SETTINGS];
  // Also validate direct callers, before deleting anything. Files before
  // version 11 (public PR 61) had one agentQuery; from 11 it's never brought back.
  let agentSearches = data.agentSearches ?? [];
  if (data.schemaVersion <= 10 && agentSearches.length === 0) {
    const query = legacyAgentQuery(settings.find((setting) => setting.key === "agentQuery")?.value ?? "null");
    if (query) agentSearches = [{ id: "agent-search-legacy", name: "My search", query, enabled: true, sort: 0, profileId: null, allProfiles: false, createdAt: data.exportedAt, updatedAt: data.exportedAt }];
  }
  if (agentSearches.length > MAX_AGENT_SEARCHES) throw new ActionError("Keep at most three Agent searches.");
  agentSearches = agentSearches.map((search) => {
    const parsed = agentSearchInputSchema.safeParse(search);
    if (!parsed.success) throw new ActionError(`That export has an invalid Agent search: ${parsed.error.issues[0].message}`);
    return { ...search, ...parsed.data };
  });
  await db.$transaction(
    async (tx) => {
      await lockAgentSearches(tx);
      // Out with the old. Applications take their history, documents, chat,
      // notes and jobs along; the other jobs (a resume import, postings read
      // for applications never created) hold the old data too.
      await tx.job.deleteMany();
      await tx.posting.deleteMany();
      await tx.postingSearch.deleteMany();
      await tx.agentCandidate.deleteMany();
      await tx.agentSearch.deleteMany();
      await tx.installedPortal.deleteMany();
      // Notification channels: a secret stays with the channel it belongs to, by its id; it's never in a file (E26-2).
      const secrets = new Map((await tx.notificationChannel.findMany({ select: { id: true, type: true, secretEnc: true } })).map((channel) => [channel.id, channel]));
      await tx.notificationChannel.deleteMany();
      await tx.startup.deleteMany();
      await tx.startupBlock.deleteMany();
      // Scores of postings (#208) belong to the profile being replaced; they're left out of exports, since they can be made again.
      await tx.postingScore.deleteMany();
      // Mail from Gmail belongs to the applications being replaced; the next check fetches what's still relevant.
      await tx.emailMessage.deleteMany();
      await tx.application.deleteMany();
      // Every profile, and with it its own rows (E24-1).
      await tx.profile.deleteMany();
      await tx.experience.deleteMany();
      await tx.project.deleteMany();
      await tx.skill.deleteMany();
      await Promise.all([
        tx.profileField.deleteMany(),
        tx.language.deleteMany(),
        tx.education.deleteMany(),
        tx.certification.deleteMany(),
        tx.customSection.deleteMany(),
        tx.publication.deleteMany(),
        tx.reference.deleteMany(),
        tx.fact.deleteMany(),
        tx.theme.deleteMany({ where: { builtIn: false } }),
        tx.setting.deleteMany({ where: { key: { notIn: keptKeys } } }),
      ]);

      // In with the new. The profiles first (E24-1): a file before version 13
      // has one, made from its headline, summary and Base resume settings,
      // and its rows say nothing of profiles, so they go to the first.
      const profiles = data.profiles?.length ? data.profiles : [legacyProfile(data)];
      await tx.profile.createMany({ data: profiles });
      const known = new Set(profiles.map((entry) => entry.id));
      const first = [...profiles].sort((a, b) => a.sort - b.sort || a.createdAt.getTime() - b.createdAt.getTime())[0].id;
      const own = <T extends { profileId?: string }>(row: T) => ({ ...row, profileId: row.profileId && known.has(row.profileId) ? row.profileId : first });

      await tx.profileField.createMany({ data: profile.fields.filter((field) => !isOwnBasic(field.key)) });
      await tx.skill.createMany({ data: profile.skills.map(own) });
      await tx.language.createMany({ data: profile.languages });
      await tx.experience.createMany({ data: profile.experience.map((entry) => own(omit(entry, "skillIds"))) });
      await tx.experienceSkill.createMany({
        data: profile.experience.flatMap((entry) => [...new Set(entry.skillIds)].map((skillId) => ({ experienceId: entry.id, skillId }))),
      });
      await tx.project.createMany({ data: profile.projects.map((entry) => own(omit(entry, "skillIds"))) });
      await tx.projectSkill.createMany({
        data: profile.projects.flatMap((entry) => [...new Set(entry.skillIds)].map((skillId) => ({ projectId: entry.id, skillId }))),
      });
      await tx.education.createMany({ data: profile.education.map(own) });
      await tx.certification.createMany({ data: profile.certifications.map(own) });
      await tx.customSection.createMany({ data: profile.customSections.map((section) => own(omit(section, "items"))) });
      await tx.customItem.createMany({ data: profile.customSections.flatMap((section) => section.items.map((item) => ({ ...item, sectionId: section.id }))) });
      await tx.publication.createMany({ data: profile.publications.map(own) });
      await tx.reference.createMany({ data: profile.references.map(own) });
      await tx.fact.createMany({ data: profile.facts });
      await tx.theme.createMany({ data: themes.map((theme) => ({ ...theme, builtIn: false })) });
      await tx.setting.createMany({
        data: settings.filter(
          (setting) => setting.key !== "agentQuery" && !SECRET_SETTINGS.includes(setting.key) && !INSTALL_SETTINGS.includes(setting.key) && !isProfileSetting(setting.key),
        ),
      });
      for (const [key, value] of Object.entries(fromFile)) if (value) await tx.setting.create({ data: { key, value } });
      // A file from before version 12 has one job source and a key per source: into the portals' shape, once.
      await moveJobSettings(tx);

      const themeIds = new Set((await tx.theme.findMany({ select: { id: true } })).map((theme) => theme.id));
      await tx.application.createMany({
        data: applications.map((application) => ({
          ...omit(application, "events", "documents", "messages", "notes", "facts", "knownGaps", "interviews", "offer", "userNote"),
          // Its profile is one of the file's, or the first (E24-6).
          profileId: application.profileId && known.has(application.profileId) ? application.profileId : null,
          extracted: json(application.extracted),
          match: json(application.match),
          sections: json(application.sections),
          frozen: json(application.frozen),
          resumeFit: json(application.resumeFit),
          messageDraft: json(application.messageDraft),
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
      // An older file's "Anything I should know?" becomes the application's first fact, as on upgrading (APP-15).
      await tx.fact.createMany({
        data: applications.flatMap((application) => [
          ...(application.facts.length === 0 && application.userNote?.trim()
            ? [{ text: application.userNote.trim(), createdAt: application.createdAt, updatedAt: application.createdAt }]
            : []),
          ...application.facts,
        ].map((fact) => ({ ...fact, applicationId: application.id }))),
      });
      await tx.offer.createMany({
        data: applications.flatMap((application) => (application.offer ? [{ ...application.offer, applicationId: application.id }] : [])),
      });
      await tx.interview.createMany({
        data: applications.flatMap((application) => application.interviews.map((round) => ({ ...round, applicationId: application.id, prep: json(round.prep) }))),
      });
      await tx.knownGap.createMany({
        data: applications.flatMap((application) => application.knownGaps.map((gap) => ({ ...gap, applicationId: application.id }))),
      });
      // A posting's application that isn't in the file leaves it unlinked.
      const applicationIds = new Set(applications.map((application) => application.id));
      await tx.posting.createMany({
        data: postings.map((posting) => ({
          ...posting,
          applicationId: posting.applicationId && applicationIds.has(posting.applicationId) ? posting.applicationId : null,
          // Before version 12, a file held kept postings only: seen, and last found when kept.
          lastFoundAt: posting.lastFoundAt ?? posting.createdAt,
          seenAt: posting.seenAt === undefined ? posting.updatedAt : posting.seenAt,
          mergedIntoId: null,
        })),
      });
      // The same job on another portal (E22-6), once every posting is there to point to.
      const postingIds = new Set(postings.map((posting) => posting.id));
      for (const posting of postings) {
        if (posting.mergedIntoId && posting.mergedIntoId !== posting.id && postingIds.has(posting.mergedIntoId)) {
          await tx.posting.update({ where: { id: posting.id }, data: { mergedIntoId: posting.mergedIntoId } });
        }
      }
      await fillMatchKeys(tx);
      // The agent's searches first: its runs are searches that point to them (E22-8).
      // A search's profile is one of the file's, or the first (E24-6).
      await tx.agentSearch.createMany({ data: agentSearches.map((search) => ({ ...search, profileId: search.profileId && known.has(search.profileId) ? search.profileId : null })) });
      const searchIds = new Set(agentSearches.map((search) => search.id));
      await tx.postingSearch.createMany({
        data: searches.map((search) => ({
          ...search,
          query: (search.query ?? {}) as Prisma.InputJsonValue,
          postings: (search.postings ?? []) as Prisma.InputJsonValue,
          portals: (search.portals ?? []) as Prisma.InputJsonValue,
          agentSearchId: search.agentSearchId && searchIds.has(search.agentSearchId) ? search.agentSearchId : null,
        })),
      });
      const searchIdsKept = new Set(searches.map((search) => search.id));
      await tx.postingFind.createMany({ data: data.postingFinds.filter((find) => postingIds.has(find.postingId) && searchIdsKept.has(find.searchId)) });
      // A file from before version 12 kept what each search found as JSON: into the library, once.
      await movePastSearches(tx);
      // The job agent's candidates (E16), so what it saw stays seen; a draft that isn't in the file leaves it unlinked.
      await tx.agentCandidate.createMany({
        data: agentCandidates.map((candidate) => ({
          ...candidate,
          reasons: json(candidate.reasons),
          redFlags: json(candidate.redFlags),
          applicationId: candidate.applicationId && applicationIds.has(candidate.applicationId) ? candidate.applicationId : null,
        })),
      });
      const candidateIds = new Set(agentCandidates.filter((candidate) => candidate.status !== "DISMISSED").map((candidate) => candidate.id));
      await tx.agentCandidateSearch.createMany({
        data: (data.agentCandidateSearches ?? []).filter((link) => candidateIds.has(link.candidateId)).map((link) => ({
          ...link, searchId: link.searchId && searchIds.has(link.searchId) ? link.searchId : null,
        })),
      });
      // A file from before E22-8 kept what the agent found apart from Positions: into the library, once.
      await moveAgentFinds(tx);
      // Startups (#222) with what the user did with them; an application that isn't in the file leaves one unlinked.
      await tx.startup.createMany({
        data: startups.map((startup) => ({
          ...startup,
          roles: jsonList(startup.roles),
          emails: jsonList(startup.emails),
          links: jsonList(startup.links),
          reasons: jsonList(startup.reasons),
          applicationId: startup.applicationId && applicationIds.has(startup.applicationId) ? startup.applicationId : null,
          // Scored again on the next refresh when its profile isn't in the file (E24-6).
          profileId: startup.profileId && known.has(startup.profileId) ? startup.profileId : null,
        })),
      });
      await tx.startupBlock.createMany({ data: [...new Map(startupBlocks.map((block) => [block.hash, block])).values()] });
      // The channels, each keeping the secret it had here; a new webhook gets one of its own.
      await tx.notificationChannel.createMany({
        data: data.notificationChannels.map((channel) => {
          const own = secrets.get(channel.id);
          const secretEnc = own && own.type === channel.type ? own.secretEnc : channel.type === "WEBHOOK" ? encryptSecret(NOTIFICATION_SECRET, newWebhookSecret()) : null;
          return { ...channel, config: channel.config as Prisma.InputJsonValue, events: channel.events, secretEnc };
        }),
      });
      // The portals the user added (E23-3), as installed; one that no longer reads, or takes a built-in's id, stays out.
      await tx.installedPortal.createMany({
        data: data.installedPortals.flatMap((portal) => {
          const parsed = parsePortalConfig(portal.config);
          if (!parsed.ok || parsed.config.id !== portal.id || builtInPortal(portal.id)) return [];
          return [{ ...portal, config: portal.config as Prisma.InputJsonValue }];
        }),
      });
    },
    // A big export takes longer than the default five seconds.
    { timeout: 120_000, maxWait: 10_000 },
  );
  // The portals the file brings, known from now on.
  await loadInstalledPortals(db);
}

const isProfileSetting = (key: string) => (PROFILE_SETTING_KEYS as readonly string[]).includes(key);

/**
 * The one profile of a file before version 13 (E24-1), as the upgrade makes
 * it: named after the headline, with the headline, the summary and the Base
 * resume's settings, which were global then.
 */
function legacyProfile(data: DossierExport) {
  const field = (key: string) => data.profile.fields.find((entry) => entry.key === key)?.value ?? "";
  const headline = field("headline");
  return {
    id: "first",
    name: headline.trim().slice(0, 80) || DEFAULT_PROFILE_NAME,
    sort: 0,
    headline,
    summary: field("summary"),
    settings: Object.fromEntries(data.settings.filter((setting) => isProfileSetting(setting.key)).map((setting) => [setting.key, setting.value])),
    createdAt: data.exportedAt,
    updatedAt: data.exportedAt,
  };
}
