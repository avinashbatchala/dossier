import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// What the app remembers between launches: which mode, and which server. It
// holds no data of the user's, and nothing else reads it.

type Mode = "local" | "server";
export type Preferences = { mode: Mode | null; serverOrigin: string | null };

const NOTHING: Preferences = { mode: null, serverOrigin: null };

/** What's saved; nothing chosen if the file is missing or can't be read. */
export function readPreferences(file: string): Preferences {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return {
      mode: saved.mode === "local" || saved.mode === "server" ? saved.mode : null,
      serverOrigin: typeof saved.serverOrigin === "string" ? saved.serverOrigin : null,
    };
  } catch {
    return NOTHING;
  }
}

/** Saves through a new file, so a crash can't leave half of one. */
export function writePreferences(file: string, preferences: Preferences): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(preferences, null, 2));
  renameSync(`${file}.tmp`, file);
}
