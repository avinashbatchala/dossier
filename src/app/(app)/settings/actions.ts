"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { AiProvider, Creativity, DateFormat, JobStatus, PaperSize, Tone } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { AiError, createProvider } from "@/lib/ai";
import { applyApiKeyChange } from "@/lib/ai/api-key";
import { keyStateOf, loadAiConfig, resolveAiConfig } from "@/lib/ai/config";
import type { KeyState } from "@/lib/ai/provider-options";
import { DOCUMENT_LANGUAGES } from "@/lib/document-language";
import { deleteAllBackups } from "@/lib/backups";
import { env } from "@/lib/env";
import { JobSearchError, testSource } from "@/lib/job-search";
import { credentialsFor, jobSearchView, loadJobSearchConfig, requestContext } from "@/lib/job-search/config";
import { JOB_SOURCES, JSEARCH_HOSTS } from "@/lib/job-search/search";
import { cancelJob, startJob } from "@/lib/jobs/runner";
import { checkForUpdate } from "@/lib/update-check";
import { countTailoredDocuments, deleteAllDownloads, zipPdfsJob } from "@/lib/jobs/zip-pdfs";
import { disconnectGoogle } from "@/lib/google/account";
import { prisma } from "@/lib/prisma";
import { applySecretChange, JOB_SOURCE_KEY } from "@/lib/secrets";

import { seedBuiltIns } from "../../../../prisma/seed/built-ins";
import { isJobRetention } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Settings → AI provider (E6-3). Every field saves on its own, so a test
// or a model list always reflects what's saved.

/** The key state after a change, for the settings screen. */
async function currentKeyState(): Promise<KeyState> {
  const saved = await loadSettings();
  return keyStateOf(saved, resolveAiConfig(saved, env));
}

/**
 * Saves the provider, server address and model (SET-1). A key belongs to
 * its provider: switching provider removes it, so it's never sent to
 * another company's server.
 */
export const saveAiProvider = action(
  z.object({
    provider: z.enum(AiProvider),
    // Saved as typed: a half-typed address is harmless, and the connection test explains a wrong one.
    baseUrl: z.string().trim().max(500),
    model: z.string().trim().max(200),
  }),
  async ({ provider, baseUrl, model }) => {
    const current = await loadSettings();
    await saveSettings({
      provider,
      baseUrl: baseUrl || null,
      model: model || null,
      ...(current.provider !== provider ? { apiKeyEnc: null } : {}),
    });
    return { keyState: await currentKeyState() };
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
    return { keyState: await currentKeyState() };
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

/** "Test connection" (SET-2): a short prompt to the saved provider, timed. */
export const testAiConnection = action(z.object({}), async () => {
  try {
    const config = await loadAiConfig();
    const provider = createProvider({ ...config, timeoutMs: Math.min(config.timeoutMs, TEST_TIMEOUT_MS) });
    const { model, latencyMs } = await provider.test();
    return { connected: true as const, model, seconds: Math.round(latencyMs / 100) / 10 };
  } catch (error) {
    if (error instanceof AiError) return { connected: false as const, message: error.message };
    throw error;
  }
});

// Settings → Job search (E14-4). Every field saves on its own; each returns
// what the section shows, never a key.

const loadView = async () => jobSearchView(await loadJobSearchConfig());

/** Picks the source to search, or Off. */
export const saveJobSource = action(z.object({ source: z.enum([...JOB_SOURCES, "OFF"]) }), async ({ source }) => {
  await saveSettings({ jobSource: source });
  return loadView();
});

/** Saves where the JSearch key is from, or the Adzuna app ID, which isn't a secret. */
export const saveJobSearchDetails = action(
  z.strictObject({ jsearchHost: z.enum(JSEARCH_HOSTS).optional(), adzunaAppId: z.string().trim().max(200).optional() }),
  async ({ jsearchHost, adzunaAppId }) => {
    await saveSettings({ jsearchHost, ...(adzunaAppId === undefined ? {} : { adzunaAppId: adzunaAppId || null }) });
    return loadView();
  },
);

/** Saves a source's key, encrypted for job sources only, or removes it. The key never comes back to the browser. */
export const saveJobSourceKey = action(
  z.object({
    source: z.enum(["JSEARCH", "ADZUNA"]),
    change: z.discriminatedUnion("action", [
      z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(1000) }),
      z.object({ action: z.literal("clear") }),
    ]),
  }),
  async ({ source, change }) => {
    const field = source === "JSEARCH" ? "jsearchKeyEnc" : "adzunaKeyEnc";
    const current = await loadSettings();
    await saveSettings({ [field]: applySecretChange(JOB_SOURCE_KEY, current[field], change) });
    return loadView();
  },
);

/** "Test connection": the smallest request the chosen source takes, timed. */
export const testJobSource = action(z.object({}), async () => {
  const config = await loadJobSearchConfig();
  if (!config.source) return { connected: false as const, message: "Choose a source first." };
  const started = performance.now();
  try {
    await testSource(config.source, credentialsFor(config, config.source), requestContext(config.source));
    return { connected: true as const, seconds: Math.round((performance.now() - started) / 100) / 10 };
  } catch (error) {
    if (error instanceof JobSearchError) return { connected: false as const, message: error.message };
    throw error;
  }
});

/**
 * Saves the settings that are a plain choice or switch, each as it changes
 * (E10-2, E10-3). Only the fields given are touched.
 */
export const updateSettings = action(
  z.strictObject({
    creativity: z.enum(Creativity).optional(),
    strict: z.boolean().optional(),
    showDiff: z.boolean().optional(),
    paper: z.enum(PaperSize).optional(),
    dateFormat: z.enum(DateFormat).optional(),
    defaultTone: z.enum(Tone).optional(),
    /** A language name, or null for the posting's language. */
    docLanguage: z.string().trim().min(1).max(60).nullable().optional(),
    fileNamePattern: z.string().max(200).optional(),
    includeRefs: z.boolean().optional(),
    onePage: z.boolean().optional(),
    nightlyBackup: z.boolean().optional(),
    jobRetentionHours: z.number().refine(isJobRetention).optional(),
    updateCheck: z.boolean().optional(),
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
    await tx.job.deleteMany();
    // Find jobs' postings and past searches (E14-9, E14-10).
    await tx.posting.deleteMany();
    await tx.postingSearch.deleteMany();
    // Mail fetched from Gmail (E15-3).
    await tx.emailMessage.deleteMany();
    // Applications take their history, documents, chat and notes along.
    await tx.application.deleteMany();
    await tx.experience.deleteMany();
    await tx.skill.deleteMany();
    await tx.language.deleteMany();
    await tx.education.deleteMany();
    await tx.reference.deleteMany();
    await tx.profileField.deleteMany();
    await tx.theme.deleteMany({ where: { builtIn: false } });
    await tx.setting.deleteMany();
  });
  // An empty profile and default settings need no rows; the built-in themes do.
  await seedBuiltIns(prisma);
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
