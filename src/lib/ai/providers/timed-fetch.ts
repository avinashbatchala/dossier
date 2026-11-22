import "server-only";

import { Agent, fetch as undiciFetch } from "undici";

// Node's fetch gives up on a response whose headers haven't come after 300
// seconds (undici's headersTimeout), and on a body that stalls as long. No AI
// call streams, so the headers only come once the whole answer is written,
// and a call past five minutes failed whatever the timeout said (#228).
// AI requests go through an Agent of their own, whose limits follow the
// provider's timeout. Node's fetch takes no Agent from the undici package
// (its own copy is another version), so they use that package's fetch too.

/** Past the provider's timeout, so its own AbortSignal ends the call first and says it timed out. */
const SLACK_MS = 1_000;

const agents = new Map<number, Agent>();

/** A fetch for an AI provider's requests, which waits for an answer as long as `timeoutMs` allows. */
export function timedFetch(timeoutMs: number): typeof fetch {
  const limit = timeoutMs + SLACK_MS;
  let dispatcher = agents.get(limit);
  if (!dispatcher) {
    dispatcher = new Agent({ headersTimeout: limit, bodyTimeout: limit });
    agents.set(limit, dispatcher);
  }
  return (input, init) => {
    // The SDKs pass an address; a Request from Node's fetch is another class to this one.
    if (input instanceof Request) throw new TypeError("An AI request goes by its address, not as a Request.");
    return undiciFetch(input, { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  };
}
