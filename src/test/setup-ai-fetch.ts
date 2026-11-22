import { vi } from "vitest";

// AI providers fetch through undici's own fetch (timed-fetch.ts), which a
// test's stubbed global fetch (test-http.ts) never sees. Here they use the
// global one again; timed-fetch.test.ts tests the real thing.
vi.mock("@/lib/ai/providers/timed-fetch", () => ({
  timedFetch: () => (input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init),
}));
