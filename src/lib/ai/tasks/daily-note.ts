import type { Task } from "./prompt-parts";
import { system } from "./prompt-parts";

const DAILY_NOTE_VERSION = "daily-note@1";

// The dashboard's daily note (E28-6): a short, kind message for someone in
// a job search. Decided 16 November 2026 (U3): it carries none of the
// user's data, so the model knows nothing about them and can't make
// anything up about them either.

/** What the note can be about, one picked at random, so the days differ. */
export const NOTE_THEMES = [
  "keeping going when it's quiet",
  "small steps adding up",
  "rest being part of the work",
  "curiosity about what comes next",
  "being kind to yourself",
  "the courage it takes to apply",
  "every no making room for a yes",
  "preparation meeting chance",
  "your experience being worth something",
  "a fresh start each morning",
] as const;

const INSTRUCTIONS = `You write one short, warm note for someone in the middle of a job search, to read on their dashboard today.

Rules:
- One or two sentences, under 40 words, plain text: no quotes, emoji, hashtags or headings.
- Speak to them directly ("you"). Encouraging and calm, never pushy or cheesy.
- You know nothing about them: never mention a name, a company, a role, a number, a date or anything they did.
- Answer with the note only.`;

export type DailyNoteInput = {
  /** One of NOTE_THEMES. */
  theme: string;
  /** The note it replaces, for "Another one": the new one has to be different. */
  previous?: string;
};

/** Plain, one line, at most 60 words: what the dashboard shows. */
function tidyNote(text: string): string {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .split(" ");
  return words.slice(0, 60).join(" ");
}

/** E28-6: one note, about the theme given. Nothing about the user is sent. */
export const writeDailyNote: Task<DailyNoteInput, string> = async (provider, { theme, previous }, { signal }) => {
  const asked = [`Today's note is about ${theme}.`, previous && `It must be different from this one: ${previous}`].filter(Boolean).join("\n");
  const answer = await provider.complete({
    task: "daily-note",
    system: system(INSTRUCTIONS),
    messages: [{ role: "user", content: asked }],
    creativity: "EXPRESSIVE",
    effort: "low",
    maxTokens: 200,
    signal,
  });
  return { data: tidyNote(answer), promptVersion: DAILY_NOTE_VERSION };
};
