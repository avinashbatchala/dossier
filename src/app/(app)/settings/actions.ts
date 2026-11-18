"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AiProvider, Creativity, DateFormat, JobStatus, PaperSize, Tone } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { lockAgentSearches } from "@/lib/agent/searches";
import { AiError, createProvider } from "@/lib/ai";
import { applyApiKeyChange } from "@/lib/ai/api-key";
import { keyEnding, keyStateOf, loadAiConfig, loadAiSettingsView, resolveAiConfig, sameServer } from "@/lib/ai/config";
import { AI_TIMEOUT_LIMITS, type KeyState } from "@/lib/ai/provider-options";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { deleteAllBackups } from "@/lib/backups";
import { env } from "@/lib/env";
import { JobSearchError, testSource } from "@/lib/job-search";
import { credentialsFor, jobSearchView, loadJobSearchConfig, portalSetup, requestContext, savePortals } from "@/lib/job-search/config";
import { sourceIdSchema, type JobSource } from "@/lib/job-search/search";
import { sourceInfo } from "@/lib/job-search/sources";
import { BUILT_IN_PORTALS } from "@/lib/portals/built-in";
import { catalogView, isReviewed, loadCatalog, readCatalog } from "@/lib/portals/catalog";
import { portalUpdates, updateFor } from "@/lib/portals/updates";
import { fetchConfigText, installPortal, loadInstalledPortals, MAX_CONFIG_BYTES, previewConfig, removeInstalledPortal } from "@/lib/portals/installed";
import { listEntries } from "@/lib/portals/list-field";
import { cancelJob, startJob } from "@/lib/jobs/runner";
import { checkForUpdate } from "@/lib/update-check";
import { redirectProblem } from "@/lib/connector/oauth";
import { countTailoredDocuments, deleteAllDownloads, zipPdfsJob } from "@/lib/jobs/zip-pdfs";
import { disconnectGoogle } from "@/lib/google/account";
import { prisma } from "@/lib/prisma";
import { loadScoringConfig, SCORER_KEY_CONTEXT, scoringView } from "@/lib/scoring/config";
import { testScorer } from "@/lib/scoring";
import { SCORER_INFO, SCORERS } from "@/lib/scoring/scorers";
import { applySecretChange, JOB_SOURCE_KEY } from "@/lib/secrets";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";
import { DOCUMENTS_TO_WRITE, isArchiveDays, isJobRetention } from "@/lib/settings";
import { firstProfileId } from "@/lib/profiles";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Settings → AI provider (E6-3). Every field saves on its own, so a test
// or a model list always reflects what's saved.

/** The key state after a change, for the settings screen. */
async function currentKeyState(): Promise<KeyState> {
  const saved = await loadSettings();
  return keyStateOf(saved, resolveAiConfig(saved, env));
}

/** The saved key's last four characters (ST4), for the masked field. */
async function currentKeyEnding(): Promise<string | null> {
  return keyEnding(await loadSettings());
}

/**
 * Saves the provider, server address and model (SET-1). A key belongs to
 * its provider and server: another provider, or an address on another host
 * (public PR 107), removes it, so it's never sent to a server it wasn't
 * made for. Another path or model keeps it. `keyRemoved` says when a new
 * address took it, which the screen explains.
 */
export const saveAiProvider = action(
  z.object({
    provider: z.enum(AiProvider),
    // Saved as typed: the connection test explains a wrong address. A half-typed one on another host removes the key too.
    baseUrl: z.string().trim().max(500),
    model: z.string().trim().max(200),
  }),
  async ({ provider, baseUrl, model }) => {
    const current = await loadSettings();
    const keepsKey = current.provider === provider && sameServer(provider, current.baseUrl, baseUrl);
    await saveSettings({
      provider,
      baseUrl: baseUrl || null,
      model: model || null,
      ...(keepsKey ? {} : { apiKeyEnc: null }),
    });
    const keyRemoved = current.provider === provider && !keepsKey && current.apiKeyEnc !== null;
    return { keyState: await currentKeyState(), keyEnding: await currentKeyEnding(), ...(keyRemoved ? { keyRemoved } : {}) };
  },
);

/** Saves a new API key, encrypted (E6-2), or removes it. The key never comes back to the browser. */
export const saveApiKey = action(
  z.object({
    provider: z.enum(AiProvider),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ provider, change }) => {
    const current = await loadSettings();
    await saveSettings({
      apiKeyEnc: applyApiKeyChange(current.apiKeyEnc, change),
      // Until now the provider came from DOSSIER_AI_*; the key makes it a saved choice.
      ...(current.provider ? {} : { provider }),
    });
    return { keyState: await currentKeyState(), keyEnding: await currentKeyEnding() };
  },
);

/**
 * How long one AI request may take, in seconds (public issue 118); null goes
 * back to DOSSIER_AI_TIMEOUT_SECONDS, or the provider's own. A task started
 * after the change has it.
 */
export const saveAiTimeout = action(
  z.object({ seconds: z.number().int().min(AI_TIMEOUT_LIMITS.min).max(AI_TIMEOUT_LIMITS.max).nullable() }),
  async ({ seconds }) => {
    await saveSettings({ aiTimeoutSeconds: seconds });
    return { seconds };
  },
);

/** The models the saved server offers, for the model select. */
export const listAiModels = action(z.object({}), async () => {
  try {
    const provider = createProvider(await loadAiConfig());
    return { models: await provider.listModels(AbortSignal.timeout(15_000)), problem: null };
  } catch (error) {
    if (error instanceof AiError) return { models: [], problem: error.message };
    throw error;
  }
});

/** A test connection on a stop-watch has no business waiting minutes. */
const TEST_TIMEOUT_MS = 60_000;

/**
 * "Test connection" (SET-2): a short prompt to the saved provider, timed.
 * The result is kept (E34-1), with what it tested, for the section and the
 * overview; a change to the provider, address or model makes it old.
 */
export const testAiConnection = action(z.object({}), async () => {
  // What it tests, read without the key, so a key that can't be read is a result too.
  const { provider: chosen, baseUrl, model: chosenModel } = await loadAiSettingsView();
  const tested = { at: new Date().toISOString(), provider: chosen, baseUrl, model: chosenModel };
  try {
    const config = await loadAiConfig();
    const provider = createProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, TEST_TIMEOUT_MS) });
    const { model, latencyMs } = await provider.test();
    const seconds = Math.round(latencyMs / 100) / 10;
    await saveSettings({ aiTest: { ...tested, ok: true, seconds, error: null } });
    return { connected: true as const, model, seconds, at: tested.at };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    await saveSettings({ aiTest: { ...tested, ok: false, seconds: null, error: error.message } });
    return { connected: false as const, message: error.message, at: tested.at };
  }
});

// Settings → Job search (E14-4, E22-3). Every field saves on its own; each
// returns what the section shows, never a key.

const loadView = async () => {
  const config = await loadJobSearchConfig();
  return jobSearchView(config, await portalUpdates(config));
};

const portalId = sourceIdSchema;

/** The portal's config, or an error for one this server doesn't offer. */
async function offeredPortal(id: JobSource) {
  const setup = portalSetup(await loadJobSearchConfig(), id);
  if (!setup?.offered) throw new ActionError(`${sourceInfo(id).name} isn't offered on this server.`);
  return setup;
}

/**
 * Switches a portal on or off; any number can be on. One with a note (the
 * Bundesagentur für Arbeit's, #223) only goes on with it accepted, now
 * (`accepted`) or before.
 */
export const setPortalOn = action(z.object({ portal: portalId, on: z.boolean(), accepted: z.literal(true).optional() }), async ({ portal, on, accepted }) => {
  const setup = await offeredPortal(portal);
  if (on && setup.config.consent && !setup.acceptedAt && !accepted) {
    throw new ActionError("Tick “I understand” under the note first.");
  }
  await savePortals(({ portals, keys }) => {
    const current = portals[portal] ?? { on: false, fields: {}, acceptedAt: null };
    const acceptedAt = accepted ? new Date().toISOString() : current.acceptedAt;
    return { portals: { ...portals, [portal]: { ...current, on, acceptedAt } }, keys };
  });
  return loadView();
});

/** Saves one of a portal's text, choice or list fields (the Adzuna app ID, the JSearch host, companies' boards), which aren't secrets. */
export const savePortalField = action(
  z.object({ portal: portalId, field: z.string().min(1).max(40), value: z.string().trim().max(5000) }),
  async ({ portal, field, value: typed }) => {
    const setup = await offeredPortal(portal);
    const definition = setup.config.fields.find((entry) => entry.name === field);
    if (!definition || (definition.type !== "text" && definition.type !== "choice" && definition.type !== "list")) throw new ActionError("That field can't be saved here.");
    if (definition.type === "text" && typed.length > 500) throw new ActionError("That's longer than this field takes.");
    if (definition.type === "choice" && !definition.options.some((option) => option.value === typed)) throw new ActionError("Choose one of the options.");
    let value = typed;
    if (definition.type === "list") {
      // Kept one a line, as the search reads them; a line that's neither a name nor a link is said, not dropped.
      const { entries, unread } = listEntries(typed, Number.MAX_SAFE_INTEGER);
      if (unread.length > 0) throw new ActionError(`${unread.length === 1 ? `“${unread[0]}” isn't` : `${unread.length} lines aren't`} a name or a link Dossier can read.`);
      if (entries.length > definition.max) throw new ActionError(`${definition.label} takes up to ${definition.max}.`);
      value = entries.join("\n");
    }
    await savePortals(({ portals, keys }) => {
      const current = portals[portal] ?? { on: false, fields: {}, acceptedAt: null };
      const fields = { ...current.fields };
      if (value) fields[field] = value;
      else delete fields[field];
      return { portals: { ...portals, [portal]: { ...current, fields } }, keys };
    });
    return loadView();
  },
);

/** Saves a portal's key, encrypted for job sources only, or removes it. The key never comes back to the browser. */
export const savePortalKey = action(
  z.object({
    portal: portalId,
    field: z.string().min(1).max(40),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ portal, field, change }) => {
    const setup = await offeredPortal(portal);
    if (setup.config.fields.find((entry) => entry.name === field)?.type !== "secret") throw new ActionError("That isn't a key.");
    await savePortals(({ portals, keys }) => {
      const own = { ...keys[portal] };
      const stored = applySecretChange(JOB_SOURCE_KEY, own[field] ?? null, change);
      if (stored) own[field] = stored;
      else delete own[field];
      return { portals: { ...portals, [portal]: portals[portal] ?? { on: false, fields: {}, acceptedAt: null } }, keys: { ...keys, [portal]: own } };
    });
    return loadView();
  },
);

/**
 * Add portal (E23-3): a config from a file's text or a link, shown before
 * it's installed, or what's wrong with it in words.
 */
export const previewPortal = action(
  z.union([z.object({ text: z.string().max(2 * MAX_CONFIG_BYTES) }), z.object({ url: z.string().trim().max(2000) })]),
  async (input) => {
    await loadInstalledPortals();
    const read = "url" in input ? await fetchConfigText(input.url) : ({ ok: true, text: input.text } as const);
    if (!read.ok) return { ok: false as const, problems: [read.problem] };
    const result = previewConfig(read.text);
    if (!result.ok) return { ok: false as const, problems: result.problems };
    // A file or link with exactly what the catalog reviewed counts as reviewed (E23-2).
    return { ok: true as const, preview: { ...result.preview, reviewed: await isReviewed(result.config) } };
  },
);

/** Installs a config as it was previewed: a pinned copy, which nothing changes until an update is installed (E23-3). */
export const installPortalConfig = action(
  z.object({ text: z.string().max(2 * MAX_CONFIG_BYTES), origin: z.enum(["file", "link"]), originUrl: z.url({ protocol: /^https$/ }).max(2000).nullable() }),
  async ({ text, origin, originUrl }, { toast }) => {
    await loadInstalledPortals();
    const result = previewConfig(text);
    if (!result.ok) throw new ActionError(result.problems[0]);
    await installPortal(result.config, { origin, originUrl: origin === "link" ? originUrl : null, reviewed: await isReviewed(result.config) });
    toast(`${result.config.name} added. Switch it on to search it.`);
    revalidatePath("/", "layout");
    return loadView();
  },
);

/** The catalog for Browse portals (E23-4), read again now (at most once a minute), each entry with where it stands here. */
async function loadCatalogView() {
  const installed = await loadInstalledPortals();
  return catalogView(new Map(installed.map((portal) => [portal.config.id, portal.config.version])), new Set(BUILT_IN_PORTALS.map((config) => config.id)));
}

export const browsePortals = action(z.object({}), async () => {
  await readCatalog({ force: true });
  return loadCatalogView();
});

/** Adds a portal from the catalog, as reviewed (E23-4), after the same preview as Add portal. */
export const installFromCatalog = action(z.object({ portal: portalId }), async ({ portal }, { toast }) => {
  const entry = (await loadCatalog()).portals.find((candidate) => candidate.id === portal);
  if (!entry) throw new ActionError("That portal isn't in the catalog any more.");
  if (BUILT_IN_PORTALS.some((config) => config.id === portal)) throw new ActionError(`${entry.name} comes with Dossier already.`);
  await installPortal(entry.config, { origin: "catalog", reviewed: true });
  toast(`${entry.name} added. Switch it on to search it.`);
  revalidatePath("/", "layout");
  return { view: await loadView(), catalog: await loadCatalogView() };
});

/** Removes a portal the user added, with its switch and key. What it found stays in Positions. */
export const removePortal = action(z.object({ portal: portalId }), async ({ portal }, { toast }) => {
  const setup = portalSetup(await loadJobSearchConfig(), portal);
  if (!setup?.installed) throw new ActionError("Only a portal you added can be removed.");
  await removeInstalledPortal(portal);
  await savePortals(({ portals, keys }) => ({
    portals: Object.fromEntries(Object.entries(portals).filter(([id]) => id !== portal)),
    keys: Object.fromEntries(Object.entries(keys).filter(([id]) => id !== portal)),
  }));
  toast(`${setup.config.name} removed. What it found stays in Positions.`);
  revalidatePath("/", "layout");
  return loadView();
});

/**
 * Installs a portal's update from the catalog (E23-5), a built-in's too. A
 * version that reaches a new host needs the user's approval of each.
 */
export const updatePortal = action(z.object({ portal: portalId, approvedHosts: z.array(z.string().max(253)).max(10) }), async ({ portal, approvedHosts }, { toast }) => {
  const setup = portalSetup(await loadJobSearchConfig(), portal);
  const entry = (await loadCatalog()).portals.find((candidate) => candidate.id === portal);
  const update = setup && !setup.withdrawal ? updateFor(setup.config, entry) : null;
  if (!setup || !entry || !update) throw new ActionError("There's no update for that portal right now.");
  const unapproved = update.newHosts.filter((host) => !approvedHosts.includes(host));
  if (unapproved.length > 0) throw new ActionError(`Approve ${unapproved.join(" and ")} first: the new version reaches ${unapproved.length === 1 ? "it" : "them"}.`);
  await installPortal(entry.config, { origin: "catalog", reviewed: true });
  toast(`${entry.name} updated to version ${entry.version}.`);
  revalidatePath("/", "layout");
  return loadView();
});

/** "Keep searching it": a portal the catalog withdrew goes on being searched, as the user decided (E23-5). */
export const keepWithdrawnPortal = action(z.object({ portal: portalId }), async ({ portal }, { toast }) => {
  const setup = portalSetup(await loadJobSearchConfig(), portal);
  if (!setup?.withdrawal) throw new ActionError("That portal isn't withdrawn.");
  const { portalWithdrawalsKept } = await loadSettings();
  await saveSettings({ portalWithdrawalsKept: { ...portalWithdrawalsKept, [portal]: setup.withdrawal.withdrawnAt } });
  toast(`${setup.config.name} is searched again.`);
  return loadView();
});

/** "Test connection": the smallest request a portal takes, timed. */
export const testPortal = action(z.object({ portal: portalId }), async ({ portal }) => {
  const config = await loadJobSearchConfig();
  const started = performance.now();
  try {
    await testSource(portal, credentialsFor(config, portal), requestContext(portal));
    return { connected: true as const, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof JobSearchError) return { connected: false as const, message: error.message };
    throw error;
  }
});

// Settings → Scoring (#274). Each returns what the section shows, never the key.

const loadScoringView = async () => scoringView(await loadScoringConfig());

/** Which scoring model scores postings (E25-2). */
export const saveScorer = action(z.object({ scorer: z.enum(SCORERS) }), async ({ scorer }) => {
  await saveSettings({ scorer });
  return loadScoringView();
});

/** Saves a scoring model's key, encrypted for it only, or removes it (E25-2). */
export const saveScoringKey = action(
  z.object({
    scorer: z.enum(SCORERS),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ scorer, change }) => {
    const key = SCORER_INFO[scorer].key;
    const context = SCORER_KEY_CONTEXT[scorer];
    if (!key || !context) throw new ActionError(`${SCORER_INFO[scorer].name} needs no key.`);
    const current = await loadSettings();
    await saveSettings({ [key.setting]: applySecretChange(context, current[key.setting], change) });
    return loadScoringView();
  },
);

/** The OpenRouter model that scores (E25-4); empty for the default. */
export const saveOpenRouterScoringModel = action(z.object({ model: z.string().trim().max(200) }), async ({ model }) => {
  await saveSettings({ openrouterScoringModel: model || null });
  return loadScoringView();
});

/** "Test connection" for a scoring model: one short question, timed. It costs a few dozen tokens. */
export const testScoringModel = action(z.object({ scorer: z.enum(SCORERS) }), async ({ scorer }) => testScorer(scorer, TEST_TIMEOUT_MS));

/**
 * Saves the settings that are a plain choice or switch, each as it changes
 * (E10-2, E10-3). Only the fields given are touched.
 */
export const updateSettings = action(
  z.strictObject({
    creativity: z.enum(Creativity).optional(),
    strict: z.boolean().optional(),
    showDiff: z.boolean().optional(),
    /** The dashboard's daily note by the AI (E28-6). */
    dailyNoteAi: z.boolean().optional(),
    paper: z.enum(PaperSize).optional(),
    dateFormat: z.enum(DateFormat).optional(),
    defaultTone: z.enum(Tone).optional(),
    /** A language name, or null for the posting's language. */
    docLanguage: z.string().trim().min(1).max(60).nullable().optional(),
    fileNamePattern: z.string().max(200).optional(),
    includeRefs: z.boolean().optional(),
    documentsToWrite: z.enum(DOCUMENTS_TO_WRITE).optional(),
    nightlyBackup: z.boolean().optional(),
    jobRetentionHours: z.number().refine(isJobRetention).optional(),
    updateCheck: z.boolean().optional(),
    archiveAfterDays: z.number().refine(isArchiveDays).optional(),
  }),
  async (changes) => {
    await saveSettings(changes);
    return null;
  },
);

/**
 * "Other language…" (SET-7): adds a language to the list and writes
 * documents in it. A name already in the list, in any case, is just picked.
 */
export const addDocumentLanguage = action(
  z.object({ name: z.string().trim().min(1, "Type a language first.").max(60) }),
  async ({ name }) => {
    const { customLanguages } = await loadSettings();
    const known = [...DOCUMENT_LANGUAGES.map((language) => language.name), ...customLanguages];
    const existing = known.find((language) => language.toLocaleLowerCase() === name.toLocaleLowerCase());
    await saveSettings({ docLanguage: existing ?? name, ...(existing ? {} : { customLanguages: [...customLanguages, name] }) });
    return { language: existing ?? name, added: !existing };
  },
);

/** "Download all PDFs" (E10-5): zips every tailored document in the background. */
export const startZippingPdfs = action(z.object({}), async () => {
  const documents = await countTailoredDocuments();
  if (documents === 0) throw new ActionError("There are no tailored documents to download yet.");
  return { jobId: await startJob(zipPdfsJob, {}), documents };
});

/**
 * "Delete for good" (E10-8, SET-11): removes the profile, every application
 * with its documents, custom themes, settings, background jobs and the
 * backup and download files, then puts back what a new install has. The
 * session stays; the user lands on the empty dashboard.
 */
export const deleteEverything = action(z.object({ confirm: z.literal("DELETE") }), async () => {
  const unfinished = await prisma.job.findMany({ where: { status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } }, select: { id: true } });
  for (const job of unfinished) await cancelJob(job.id);
  // Revokes Dossier's access at Google too (E15-1).
  await disconnectGoogle().catch(() => {});

  await prisma.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    await tx.job.deleteMany();
    // The tokens each AI request used (#290).
    await tx.aiUsage.deleteMany();
    // Find jobs' postings and past searches (E14-9, E14-10).
    await tx.posting.deleteMany();
    await tx.postingSearch.deleteMany();
    // Postings pasted for Claude chat (#221); the connector goes off with the settings.
    await tx.claudePaste.deleteMany();
    // The portals the user added (E23-3).
    await tx.installedPortal.deleteMany();
    // Notification channels, their secrets and their delivery log (E26).
    await tx.notificationChannel.deleteMany();
    // What the job agent found (E16).
    await tx.agentCandidate.deleteMany();
    await tx.agentSearch.deleteMany();
    await tx.postingScore.deleteMany();
    // Startups, and the fingerprints of ones removed for good (#222).
    await tx.startup.deleteMany();
    await tx.startupBlock.deleteMany();
    // Mail fetched from Gmail (E15-3).
    await tx.emailMessage.deleteMany();
    // Applications take their history, documents, chat and notes along.
    await tx.application.deleteMany();
    await tx.experience.deleteMany();
    await tx.project.deleteMany();
    await tx.skill.deleteMany();
    await tx.language.deleteMany();
    await tx.education.deleteMany();
    await tx.certification.deleteMany();
    await tx.publication.deleteMany();
    await tx.reference.deleteMany();
    await tx.customSection.deleteMany();
    // Every profile, with whatever is left of its own (E24-1).
    await tx.profile.deleteMany();
    await tx.fact.deleteMany();
    await tx.profileField.deleteMany();
    await tx.theme.deleteMany({ where: { builtIn: false } });
    await tx.setting.deleteMany();
  });
  // Default settings need no rows; the built-in themes and one empty profile do.
  await seedBuiltIns(prisma);
  await firstProfileId();
  await loadInstalledPortals();
  await Promise.all([deleteAllBackups(), deleteAllDownloads()]);

  revalidatePath("/", "layout");
  redirect("/");
});

/** "Check for updates" (E10-9): the latest release, asked for now, and kept for the sidebar's notice. */
export const checkUpdates = action(z.object({}), async () => {
  const result = await checkForUpdate();
  revalidatePath("/", "layout");
  return result.status === "newer" ? result : { status: result.status };
});

// Settings → MCP connector (#221, #281). Every connector token carries
// connectorEnabledAt, so a new value signs every app out.

/** Turns the MCP connector on, or off, which closes its addresses and signs every app out. */
export const setConnector = action(z.object({ on: z.boolean() }), async ({ on }) => {
  await saveSettings({ connectorEnabledAt: on ? new Date().toISOString() : null });
  return { on };
});

/** "Disconnect all apps": the connector stays on, but Claude and every other app have to connect again. */
export const disconnectApps = action(z.object({}), async (_input, { toast }) => {
  if (!(await loadSettings()).connectorEnabledAt) throw new ActionError("The MCP connector is off already.");
  await saveSettings({ connectorEnabledAt: new Date().toISOString() });
  toast("Every app is disconnected. Connect again from an app to use Dossier there.");
  return null;
});

const MAX_REDIRECTS = 10;

/** Lets another MCP app sign in, by the address it comes back to (#281). */
export const addConnectorRedirect = action(
  z.object({ uri: z.string().trim().min(1, "Paste the app's callback address first.").max(2000) }),
  async ({ uri }) => {
    const problem = redirectProblem(uri);
    if (problem) throw new ActionError(problem);
    const { connectorRedirects } = await loadSettings();
    if (connectorRedirects.includes(uri)) return { redirects: connectorRedirects };
    if (connectorRedirects.length >= MAX_REDIRECTS) throw new ActionError(`That's ${MAX_REDIRECTS} apps already. Remove one first.`);
    const redirects = [...connectorRedirects, uri];
    await saveSettings({ connectorRedirects: redirects });
    return { redirects };
  },
);

/** Stops an app signing in again by that address. One signed in already keeps its tokens until Disconnect all apps. */
export const removeConnectorRedirect = action(z.object({ uri: z.string().max(2000) }), async ({ uri }) => {
  const redirects = (await loadSettings()).connectorRedirects.filter((entry) => entry !== uri);
  await saveSettings({ connectorRedirects: redirects });
  return { redirects };
});
