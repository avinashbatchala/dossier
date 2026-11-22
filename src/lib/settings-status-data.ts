import "server-only";

import { AiProvider } from "@/generated/prisma/enums";
import { isAiConfigured, loadAiSettingsView } from "@/lib/ai/config";
import { providerOption } from "@/lib/ai/provider-options";
import { agentSetupProblem } from "@/lib/agent/run";
import { interruptedRunMessage } from "@/lib/agent/runs";
import { nextAgentRun } from "@/lib/agent/schedule";
import { listAgentSearches } from "@/lib/agent/searches";
import { listBackups } from "@/lib/backups";
import { isSqliteUrl } from "@/lib/database";
import { formatDateTime } from "@/lib/dates";
import { env } from "@/lib/env";
import { credentialsFor, loadJobSearchConfig } from "@/lib/job-search/config";
import { JobSearchError } from "@/lib/job-search/errors";
import { sourceInfo } from "@/lib/job-search/sources";
import { portalsOf } from "@/lib/library";
import { listChannels, listDeliveries } from "@/lib/notifications/store";
import { prisma } from "@/lib/prisma";
import { isPrivateAddress } from "@/lib/private-host";
import { scoringProblem } from "@/lib/scoring";
import { loadScoringConfig } from "@/lib/scoring/config";
import { SCORER_INFO } from "@/lib/scoring/scorers";
import type { AgentRun, AiTest, SettingsData } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { googleView, whenRan } from "@/lib/settings-views";
import { settingsStatus, type SettingsStatus, type StatusInputs } from "@/lib/settings-status";
import { lastKnownTimeZone } from "@/lib/time-zone";
import { TONES } from "@/lib/tones";
import { availableUpdate } from "@/lib/update-check";
import { appVersion } from "@/lib/version";

/** How many recent searches a portal's trouble is read from (E34-1). */
const RECENT_SEARCHES = 20;

/**
 * Whether the AI runs on the user's hardware (ST3): Ollama and LM Studio do,
 * an OpenAI-compatible server does when its address is this computer or
 * the local network, and the hosted ones never do.
 */
export function aiRunsLocally(provider: AiProvider, baseUrl: string): boolean {
  if (providerOption(provider).local) return true;
  return provider === AiProvider.OPENAI && isPrivateAddress(baseUrl);
}

/** The saved connection test, if it tested what's chosen now. */
export function currentAiTest(test: AiTest | null, chosen: { provider: string; baseUrl: string; model: string }): StatusInputs["ai"]["test"] {
  if (!test || test.provider !== chosen.provider || test.baseUrl !== chosen.baseUrl || test.model !== chosen.model) return null;
  return { at: new Date(test.at), ok: test.ok, seconds: test.seconds, error: test.error };
}

/** A run that ended badly: interrupted, or every one of its searches failed. */
export function runFailed(run: AgentRun): boolean {
  if (run.message === null) return false;
  if (run.message.startsWith("The agent scan was interrupted") || run.message === interruptedRunMessage(run)) return true;
  return Boolean(run.searches?.length) && run.searches!.every((search) => search.error !== null);
}

async function aiInputs(settings: SettingsData): Promise<StatusInputs["ai"]> {
  const [configured, view] = await Promise.all([isAiConfigured(), loadAiSettingsView()]);
  const option = providerOption(view.provider);
  const local = aiRunsLocally(view.provider, view.baseUrl);
  // A hosted provider can't write without its key; a local server, or LM Studio, may not want one.
  const needsKey = view.provider === AiProvider.ANTHROPIC || view.provider === AiProvider.MISTRAL || (view.provider === AiProvider.OPENAI && !local);
  return {
    configured,
    name: option.name,
    model: view.model || option.defaultModel,
    local,
    keyProblem: view.keyState === "unreadable" ? "unreadable" : view.keyState === "none" && needsKey ? "missing" : null,
    test: currentAiTest(settings.aiTest, view),
  };
}

async function jobsInputs(): Promise<StatusInputs["jobs"]> {
  const [config, searches] = await Promise.all([
    loadJobSearchConfig(),
    prisma.postingSearch.findMany({ orderBy: { createdAt: "desc" }, take: RECENT_SEARCHES, select: { createdAt: true, portals: true } }),
  ]);
  const setupProblem = (id: Parameters<typeof credentialsFor>[1]) => {
    try {
      credentialsFor(config, id);
      return null;
    } catch (error) {
      if (error instanceof JobSearchError) return error.message;
      throw error;
    }
  };
  return {
    portals: config.portals.filter((portal) => portal.offered).map((portal) => ({ id: portal.id, name: sourceInfo(portal.id).name, on: portal.on, setupProblem: portal.on ? setupProblem(portal.id) : null })),
    runs: searches.map((search) => ({ at: search.createdAt, portals: portalsOf(search.portals) })),
  };
}

async function agentInputs(settings: SettingsData, now: Date): Promise<StatusInputs["agent"]> {
  if (!settings.agentEnabled) return { enabled: false, searches: 0, hour: settings.agentHour, maxDrafts: settings.agentMaxDrafts, nextRun: null, lastRun: null, setupProblem: null };
  const [searches, timeZone, setupProblem] = await Promise.all([listAgentSearches(), lastKnownTimeZone(), agentSetupProblem()]);
  const last = settings.agentRuns.findLast((run) => run.message !== null);
  return {
    enabled: true,
    searches: searches.filter((search) => search.enabled).length,
    hour: settings.agentHour,
    maxDrafts: settings.agentMaxDrafts,
    nextRun: formatDateTime(nextAgentRun(now, settings.agentHour, timeZone, settings.agentRuns), timeZone, now),
    lastRun: last ? { at: new Date(last.at), failed: runFailed(last), message: last.message } : null,
    setupProblem,
  };
}

async function googleInputs(): Promise<StatusInputs["google"]> {
  const google = await googleView();
  if (google.status !== "connected") return { status: google.status, email: null, canRead: false, canUseCalendar: false, lastSync: null, problem: null };
  return { status: "connected", email: google.email, canRead: google.canRead, canUseCalendar: google.canUseCalendar, lastSync: google.lastSync, problem: google.syncProblem ?? google.signInProblem ?? null };
}

/** Every Settings section's status (E34-1), for the overview and the section list. */
export async function loadSettingsStatus(now = new Date()): Promise<SettingsStatus> {
  const settings = await loadSettings();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [ai, jobs, agent, google, scoringConfig, scoredThisMonth, channels, deliveries, backups, applications] = await Promise.all([
    aiInputs(settings),
    jobsInputs(),
    agentInputs(settings, now),
    googleInputs(),
    loadScoringConfig(),
    prisma.postingScore.count({ where: { updatedAt: { gte: monthStart } } }),
    listChannels(),
    listDeliveries(),
    listBackups(),
    prisma.application.count({ where: { awaitingReview: false } }),
  ]);
  const update = availableUpdate(settings);
  return settingsStatus({
    now,
    ai,
    documents: { paper: settings.paper === "LETTER" ? "Letter" : "A4", language: settings.docLanguage ?? "The posting's language", tone: TONES[settings.defaultTone].label },
    scoring: { name: SCORER_INFO[scoringConfig.scorer].name, problem: await scoringProblem(scoringConfig), scoredThisMonth },
    jobs,
    agent,
    google,
    notifications: { channels: channels.map((channel) => ({ name: channel.name, summary: channel.summary, paused: channel.pausedAt !== null })), lastSent: deliveries[0] ? `${deliveries[0].event}, ${deliveries[0].when}` : null },
    connector: { on: settings.connectorEnabledAt !== null },
    data: {
      nightly: settings.nightlyBackup,
      retentionDays: env.DOSSIER_BACKUP_RETENTION_DAYS,
      lastBackup: backups[0]?.modified ?? null,
      lastBackupWords: whenRan(backups[0]?.modified ?? null, now),
      problem: settings.backupProblem,
    },
    about: { version: appVersion, update: update?.version ?? null, database: isSqliteUrl(env.DATABASE_URL) ? "SQLite" : "PostgreSQL", applications },
  });
}
