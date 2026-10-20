import "server-only";

import { AiProvider } from "@/generated/prisma/enums";
import { env, type Env } from "@/lib/env";
import { loadSettings } from "@/lib/settings-data";

import { API_KEY_UNREADABLE, ApiKeyUnreadable, apiKeyState, decryptApiKey } from "./api-key";
import type { AiSettingsView, KeyState } from "./provider-options";

// Which provider to use and how to reach it (E6-1): what's saved in Settings,
// or else the DOSSIER_AI_* variables, or else the defaults below.

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string | null;
  apiKey: string | null;
  /** Why the saved key can't be used, e.g. DOSSIER_SECRET changed. */
  apiKeyProblem: string | null;
  timeoutMs: number;
};

export const PROVIDER_DEFAULTS: Record<AiProvider, { baseUrl: string; model: string | null; timeoutSeconds: number }> = {
  // Generous: a local model on a laptop can take minutes for a cover letter.
  [AiProvider.LOCAL]: { baseUrl: "http://localhost:11434", model: null, timeoutSeconds: 300 },
  [AiProvider.OPENAI]: { baseUrl: "https://api.openai.com/v1", model: null, timeoutSeconds: 120 },
  [AiProvider.ANTHROPIC]: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-5", timeoutSeconds: 120 },
  [AiProvider.MISTRAL]: { baseUrl: "https://api.mistral.ai/v1", model: "mistral-medium-latest", timeoutSeconds: 120 },
  // As generous as a local model, and loading one can take a while too.
  [AiProvider.LMSTUDIO]: { baseUrl: "http://host.docker.internal:1234", model: null, timeoutSeconds: 300 },
};

const FROM_ENV: Record<NonNullable<Env["DOSSIER_AI_PROVIDER"]>, AiProvider> = {
  local: AiProvider.LOCAL,
  openai: AiProvider.OPENAI,
  anthropic: AiProvider.ANTHROPIC,
  mistral: AiProvider.MISTRAL,
  lmstudio: AiProvider.LMSTUDIO,
};

type SavedSettings = {
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKeyEnc: string | null;
};

type AiEnv = Pick<
  Env,
  "DOSSIER_AI_PROVIDER" | "DOSSIER_AI_URL" | "DOSSIER_AI_MODEL" | "DOSSIER_AI_KEY" | "DOSSIER_AI_TIMEOUT_SECONDS"
>;

/**
 * Settings win once a provider is saved there; until then the environment
 * decides. The two are never mixed, except that an env key still serves a
 * saved provider of the same kind that has no key of its own.
 */
export function resolveAiConfig(saved: SavedSettings | null, source: AiEnv, secret?: string): AiConfig {
  const envProvider = source.DOSSIER_AI_PROVIDER ? FROM_ENV[source.DOSSIER_AI_PROVIDER] : null;
  const useSaved = Boolean(saved?.provider);
  const provider = (useSaved ? saved!.provider : envProvider) ?? AiProvider.LOCAL;
  const defaults = PROVIDER_DEFAULTS[provider];

  let apiKey: string | null = null;
  let apiKeyProblem: string | null = null;
  if (useSaved && saved!.apiKeyEnc) {
    try {
      apiKey = decryptApiKey(saved!.apiKeyEnc, secret);
    } catch (error) {
      if (!(error instanceof ApiKeyUnreadable)) throw error;
      apiKeyProblem = API_KEY_UNREADABLE;
    }
  } else if (!useSaved || envProvider === provider) {
    apiKey = source.DOSSIER_AI_KEY ?? null;
  }

  return {
    provider,
    baseUrl: (useSaved ? saved!.baseUrl : source.DOSSIER_AI_URL) || defaults.baseUrl,
    model: (useSaved ? saved!.model : source.DOSSIER_AI_MODEL) || defaults.model,
    apiKey,
    apiKeyProblem,
    timeoutMs: (source.DOSSIER_AI_TIMEOUT_SECONDS ?? defaults.timeoutSeconds) * 1000,
  };
}

/** The AI configuration in effect right now. */
export async function loadAiConfig(): Promise<AiConfig> {
  return resolveAiConfig(await loadSettings(), env);
}

/**
 * The AI settings as the settings screen shows them: what's in effect,
 * whether it comes from Settings or DOSSIER_AI_*, and never the key.
 */
export async function loadAiSettingsView(): Promise<AiSettingsView> {
  const saved = await loadSettings();
  const config = resolveAiConfig(saved, env);
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model ?? "",
    keyState: keyStateOf(saved, config),
  };
}

/** Whether a key is in play for the provider in effect, and where it comes from. */
export function keyStateOf(saved: { provider: AiProvider | null; apiKeyEnc: string | null } | null, config: AiConfig): KeyState {
  if (saved?.provider && saved.apiKeyEnc) return apiKeyState(saved.apiKeyEnc);
  return config.apiKey ? "env" : "none";
}

/** Whether an AI provider has been chosen, in Settings or with DOSSIER_AI_PROVIDER. */
export async function isAiConfigured(): Promise<boolean> {
  if (env.DOSSIER_AI_PROVIDER) return true;
  return Boolean((await loadSettings()).provider);
}
