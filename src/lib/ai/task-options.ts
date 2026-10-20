import "server-only";

import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import type { TaskOptions } from "./tasks";

/** The AI behaviour saved in Settings (SET-3, SET-4, SET-7, SET-9), for running a task. */
export async function loadTaskOptions(): Promise<Omit<TaskOptions, "signal">> {
  const { creativity, strict, docLanguage, pageLimit } = await loadSettings();
  // Null follows the posting's language.
  return { creativity, strict, language: docLanguage, maxPages: maxPages(pageLimit) };
}
