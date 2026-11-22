import "server-only";

import { getAiProvider } from "@/lib/ai";
import { isAiUsable } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { NOTE_THEMES, writeDailyNote } from "@/lib/ai/tasks/daily-note";
import { isoInZone } from "@/lib/dates";
import { logServerWarning } from "@/lib/log";
import type { DailyNote } from "@/lib/settings";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// The dashboard's daily note (E28-6): one a day, written by the AI when it
// may (Settings → AI), or else picked from the notes below. Kept in one
// setting, today's only (DB2); "Another one" up to three times a day, and
// "Hide for today" until local midnight.

/** "Another one" this many times a day. */
export const DAILY_NOTE_REWRITES = 3;

/** The written notes: without an AI provider, with the switch off, or when the AI fails. */
export const NOTE_TEMPLATES = [
  "Every application you send is a small act of courage. Today counts, even if nothing answers back yet.",
  "Quiet weeks aren't a verdict. They're just quiet. Keep your list moving, one kind step at a time.",
  "You don't need a perfect day, only a next step. Pick one small thing and let that be enough.",
  "Rest is part of the work. A clear head writes better letters than a tired one.",
  "The right role is looking for someone like you too. Keep making it easy for them to find you.",
  "Progress hides in the small things: a sharper line, a better question, one more try.",
  "A no closes one door and leaves the hallway full of others. Keep walking.",
  "Be as kind to yourself today as you'd be to a friend doing exactly this.",
  "You've done hard things before. This is one more, and you're already on your way.",
  "Curiosity beats worry. Look at today's options as possibilities, not tests.",
  "Your experience is worth more than any single answer from any single company.",
  "Slow and steady still gets there. Today, steady is plenty.",
] as const;

/** Today in the user's time zone (the server's when the browser hasn't said), as YYYY-MM-DD: when the note changes. */
export const noteDay = (now: Date, timeZone?: string) => isoInZone(now, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).slice(0, 10);

/** A written note for a day: a different one for each "Another one", and not the same as the one before it. */
export function pickTemplate(day: string, attempt: number, previous?: string): string {
  const seed = [...day].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) % 1_000_003, 7);
  const choices = NOTE_TEMPLATES.filter((note) => note !== previous);
  return choices[(seed + attempt) % choices.length];
}

/** What the dashboard shows: today's note, "hidden", or null when today's isn't written yet. */
export type NoteState = { text: string; rewritesLeft: number } | "hidden" | null;

export function noteState(note: DailyNote | null, day: string): NoteState {
  if (!note || note.day !== day) return null;
  if (note.hidden) return "hidden";
  return { text: note.text, rewritesLeft: Math.max(0, DAILY_NOTE_REWRITES - note.rewrites) };
}

/**
 * Writes today's note, or another one: by the AI when it may, else from the
 * written ones. Today's first note is written once, however often this is
 * asked; another one only while some are left. Nothing about the user goes
 * into the prompt.
 */
export async function writeNote({ timeZone, another, now = new Date() }: { timeZone?: string; another: boolean; now?: Date }): Promise<NoteState> {
  const day = noteDay(now, timeZone);
  const { dailyNote, dailyNoteAi } = await loadSettings();
  const current = dailyNote?.day === day ? dailyNote : null;
  if (current && (!another || current.rewrites >= DAILY_NOTE_REWRITES)) return noteState(current, day);

  const attempt = current ? current.rewrites + 1 : 0;
  const previous = current?.text;
  let text = pickTemplate(day, attempt, previous);
  if (dailyNoteAi && (await isAiUsable())) {
    try {
      const theme = NOTE_THEMES[Math.floor(Math.random() * NOTE_THEMES.length)];
      const written = (await writeDailyNote(await getAiProvider(), { theme, previous }, await loadTaskOptions())).data;
      if (written) text = written;
    } catch (error) {
      // A written note instead: the dashboard never waits on a failed AI call.
      logServerWarning("daily-note", `The AI's note failed, so a written one is shown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const note: DailyNote = { day, text, rewrites: attempt, hidden: false };
  await saveSettings({ dailyNote: note });
  return noteState(note, day);
}

/** "Hide for today": until the day changes in the user's time zone. */
export async function hideNote({ timeZone, now = new Date() }: { timeZone?: string; now?: Date }): Promise<void> {
  const day = noteDay(now, timeZone);
  const { dailyNote } = await loadSettings();
  const note: DailyNote = dailyNote?.day === day ? { ...dailyNote, hidden: true } : { day, text: "", rewrites: 0, hidden: true };
  await saveSettings({ dailyNote: note });
}
