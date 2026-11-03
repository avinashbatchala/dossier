import { randomUUID } from "node:crypto";

import { appVersion } from "@/lib/version";

/**
 * Servers that speak OpenAI's chat API with a difference, recognised by their
 * address, whichever provider in Settings reaches them (most often
 * OpenAI-compatible). To make another one work, add an entry here and a case
 * to servers.test.ts; the provider applies it, and nothing else needs to know.
 */
export type Server = {
  /** Who runs it, for the tests and anyone reading. */
  name: string;
  /** Its domain; subdomains count too. */
  domain: string;
  /** The API's path for the one entered (without a trailing slash), when people tend to enter another. */
  path?: (path: string) => string;
  /** Headers for every request, made once per provider: Dossier makes one for each task. */
  headers?: () => Record<string, string>;
  /** Fields every chat request gets on top of OpenAI's. */
  chat?: Record<string, unknown>;
  /** It takes a JSON schema in `response_format` without holding answers to it, so the schema goes in the prompt instead. */
  ignoresSchemas?: true;
};

export const SERVERS: readonly Server[] = [
  {
    // Its models think before they answer unless told not to, and the
    // thinking counts towards `max_tokens`, so longer answers ran out of room
    // (#189). By the server rather than the model's name, which other hosts
    // of the same models don't share.
    name: "DeepSeek",
    domain: "deepseek.com",
    chat: { thinking: { type: "disabled" } },
  },
  {
    // Its API is at /api/v1. At /v1, the address people try first, its
    // website answers with a 404 page.
    name: "OpenRouter",
    domain: "openrouter.ai",
    path: (path) => (/^(\/api|\/v1)?$/.test(path) ? "/api/v1" : path),
  },
  {
    // OpenCode's Go and Zen plans. Chat refuses a request without a session
    // header ("MissingSessionID"), and OpenCode asks clients to name
    // themselves in the user agent. Its docs give chat at …/openai/v1, where
    // the model list is a 404; both work at …/v1.
    name: "OpenCode",
    domain: "opencode.ai",
    path: (path) => path.replace(/\/openai(\/v1)?$/, "/v1"),
    headers: () => ({
      "User-Agent": `Dossier/${appVersion} (+https://github.com/AienTech/dossier)`,
      "x-opencode-session": `ses_${randomUUID()}`,
    }),
  },
  {
    // Ollama's cloud (https://ollama.com/v1) accepts `response_format` but
    // doesn't hold answers to the schema (public issue 40, #276): the model
    // never saw it, and answers it had to guess the shape of failed.
    name: "Ollama Cloud",
    domain: "ollama.com",
    ignoresSchemas: true,
  },
];

/** The entry for the server at `baseURL`, if it's one of them. */
export function serverAt(baseURL: string): Server | undefined {
  const host = URL.canParse(baseURL) ? new URL(baseURL).hostname : "";
  return SERVERS.find(({ domain }) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Whether answers from `model` at `baseURL` need the JSON schema in the
 * prompt: Ollama's cloud, and its cloud models through a local Ollama, which
 * are named …-cloud (gpt-oss:120b-cloud).
 */
export function ignoresSchemas(baseURL: string, model: string): boolean {
  return serverAt(baseURL)?.ignoresSchemas === true || model.endsWith("-cloud");
}

/** `baseURL` with the path its server's API is at; other addresses as they are. */
export function apiAddress(baseURL: string): string {
  const path = serverAt(baseURL)?.path;
  if (!path) return baseURL;
  const url = new URL(baseURL);
  url.pathname = path(withoutSlashes(url.pathname));
  return withoutSlashes(url.href);
}

/** `text` without the slashes it ends with. */
function withoutSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === "/") end--;
  return text.slice(0, end);
}
