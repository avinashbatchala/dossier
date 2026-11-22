// The new application draft, kept in the tab's sessionStorage (E7-7,
// decided 28 September 2026): a reload picks up where it was, even while a
// job runs; closing the tab or "+ New application" clears it. Nothing goes to
// the server until the application is created.

const KEY = "dossier:new-application";
/** Bump when the draft's shape changes, so an old one is dropped rather than misread. */
const VERSION = 2;

type Listener = () => void;

export type DraftStore<T> = {
  /** The stored draft, or null; the same object until it changes. */
  get: () => T | null;
  set: (draft: T) => void;
  clear: () => void;
  subscribe: (listener: Listener) => () => void;
};

export function createDraftStore<T>(key = KEY): DraftStore<T> {
  const listeners = new Set<Listener>();
  let cache: { raw: string | null; draft: T | null } | undefined;

  const read = (): string | null => {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      // Storage blocked: the draft lives only as long as the page.
      return cache?.raw ?? null;
    }
  };

  const notify = () => listeners.forEach((listener) => listener());

  return {
    get() {
      const raw = read();
      if (cache && cache.raw === raw) return cache.draft;
      let draft: T | null = null;
      try {
        const stored = raw ? (JSON.parse(raw) as { version?: number; draft?: T }) : null;
        draft = stored?.version === VERSION && stored.draft ? stored.draft : null;
      } catch {
        draft = null;
      }
      cache = { raw, draft };
      return draft;
    },
    set(draft) {
      const raw = JSON.stringify({ version: VERSION, draft });
      cache = { raw, draft };
      try {
        window.sessionStorage.setItem(key, raw);
      } catch {
        // Keep it in memory only.
      }
      notify();
    },
    clear() {
      cache = { raw: null, draft: null };
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // Nothing stored.
      }
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
