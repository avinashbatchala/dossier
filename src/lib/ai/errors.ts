// What can go wrong when talking to an AI provider, in words people can act
// on (E6-1). Provider messages never reach the UI or the logs as they are:
// some of them echo parts of the request, such as a masked API key.

export type AiErrorKind =
  | "unreachable"
  | "auth"
  | "model"
  | "rate-limited"
  | "busy"
  | "timeout"
  | "too-long"
  | "cancelled"
  | "config"
  | "invalid-output"
  | "cut-off"
  | "provider"
  | "not-posting";

const MESSAGES: Record<Exclude<AiErrorKind, "model" | "config">, string> = {
  unreachable: "Couldn't reach the server. Check the address and that it's running.",
  auth: "The server didn't accept the API key. Check it in Settings → AI provider.",
  "rate-limited": "The AI provider is limiting requests right now. Wait a minute and try again.",
  busy: "The AI provider is overloaded right now. Try again in a moment.",
  timeout: "The model took too long to answer. Try again, or pick a faster model.",
  "too-long": "That's more text than the model can take in at once. Try a shorter posting, or a model with a larger context.",
  cancelled: "Cancelled.",
  "invalid-output": "The model's answer didn't come back in the expected shape. Try again.",
  "cut-off": "The model's answer was cut off before it was finished. Try again, or pick another model in Settings → AI provider.",
  provider: "The AI provider ran into a problem. Try again in a moment.",
  "not-posting": "That text doesn't look like a job posting: only a cookie notice, menus or a form came through. Paste the posting itself.",
};

/** An AI failure with a message for people; `retryable` says whether Retry can help. */
export class AiError extends Error {
  override name = "AiError";

  constructor(
    readonly kind: AiErrorKind,
    message: string,
    /** For the server log: status and error type, never the provider's message. */
    readonly detail?: string,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.kind !== "config" && this.kind !== "cancelled" && this.kind !== "not-posting";
  }

  static of(kind: Exclude<AiErrorKind, "model" | "config">, detail?: string): AiError {
    return new AiError(kind, MESSAGES[kind], detail);
  }

  static unknownModel(model: string, detail?: string): AiError {
    return new AiError("model", `The server doesn't have the model “${model}”. Pick another one in Settings → AI provider.`, detail);
  }

  static config(message: string): AiError {
    return new AiError("config", message);
  }
}

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"]);

/** undici's own limits on waiting for an answer, past the provider's timeout (timed-fetch.ts). */
const TIMEOUT_CODES = new Set(["UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"]);

/** Whether a message from a provider says the input didn't fit the model's context. */
export const TOO_LONG = /context|too long|too many tokens|maximum.*tokens|token limit|exceeds/i;

/** The Node.js network error behind a failed fetch, if it's one of `codes`. */
function networkCode(error: unknown, codes: ReadonlySet<string> = CONNECTION_CODES): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && codes.has(code)) return code;
    current = current.cause;
  }
  return undefined;
}

type HttpLike = { status?: unknown; status_code?: unknown; name?: unknown; message?: unknown; type?: unknown; code?: unknown };

/** An error's type or code as the server named it, such as Groq's json_validate_failed; never free text. */
function errorName(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.-]{1,64}$/.test(value) ? value : undefined;
}

/**
 * Turns whatever a provider SDK or fetch threw into an AiError. `cancelled`
 * and `timedOut` tell a cancellation by the caller apart from our timeout.
 */
export function toAiError(
  error: unknown,
  { model, cancelled, timedOut }: { model: string; cancelled?: boolean; timedOut?: boolean },
): AiError {
  if (error instanceof AiError) return error;
  // The SDKs wrap what their fetch throws, e.g. a refused redirect (keyGuardedFetch).
  if (error instanceof Error && error.cause instanceof AiError) return error.cause;
  if (cancelled) return AiError.of("cancelled");
  if (timedOut) return AiError.of("timeout");

  const e = (error ?? {}) as HttpLike;
  const name = typeof e.name === "string" ? e.name : "Error";
  const message = typeof e.message === "string" ? e.message : "";
  const status = typeof e.status === "number" ? e.status : typeof e.status_code === "number" ? e.status_code : undefined;
  const detail = [name, status, errorName(e.type), errorName(e.code)].filter(Boolean).join(" ");

  if (name === "TimeoutError" || name === "APIConnectionTimeoutError") return AiError.of("timeout", detail);
  const waited = networkCode(error, TIMEOUT_CODES);
  if (waited) return AiError.of("timeout", waited);
  if (name === "AbortError" || name === "APIUserAbortError") return AiError.of("cancelled", detail);
  const code = networkCode(error);
  if (code || name === "APIConnectionError") return AiError.of("unreachable", code ?? detail);

  switch (status) {
    case 401:
    case 403:
      return AiError.of("auth", detail);
    case 404:
      return AiError.unknownModel(model, detail);
    case 413:
      return AiError.of("too-long", detail);
    case 429:
      return AiError.of("rate-limited", detail);
    case 503:
    case 529:
      return AiError.of("busy", detail);
    case 400:
    case 422:
      return TOO_LONG.test(message) ? AiError.of("too-long", detail) : AiError.of("provider", detail);
  }
  // Ollama answers an unknown model with a plain error, whatever its status.
  if (/model .*not found|pull the model/i.test(message)) return AiError.unknownModel(model, detail);
  return AiError.of("provider", detail);
}
