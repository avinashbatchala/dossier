import "server-only";

// Answers from job sources, kept in memory for half an hour (E14-1), so going
// back, reloading or saving a posting doesn't spend the source's quota. On
// globalThis, so dev reloads keep it. Single instance, like the job runner.

export const CACHE_TTL_MS = 30 * 60_000;
const MAX_ENTRIES = 200;

type Entry = { value: unknown; expires: number };

const store: Map<string, Entry> = ((globalThis as { __dossierJobSearchCache?: Map<string, Entry> }).__dossierJobSearchCache ??= new Map());

/** What's kept under `key`, unless it's older than half an hour. */
export function cached<T>(key: string, now = Date.now()): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

/** Keeps `value` under `key`, for half an hour or `ttlMs`; past the limit, the oldest entry goes. */
export function remember(key: string, value: unknown, now = Date.now(), ttlMs = CACHE_TTL_MS): void {
  store.delete(key);
  store.set(key, { value, expires: now + ttlMs });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function clearJobSearchCache(): void {
  store.clear();
}
