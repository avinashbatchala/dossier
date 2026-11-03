// What can score postings (#274): the AI model in Settings → AI provider,
// or TypeSafe's Jev. Shared by the server and Settings → Scoring.

export const SCORERS = ["AI", "JEV"] as const;
export type Scorer = (typeof SCORERS)[number];

/** Like the job sources' keys: saved here, from DOSSIER_TYPESAFE_KEY, missing, or saved under another DOSSIER_SECRET. */
export type ScoringKeyState = "none" | "set" | "unreadable" | "env";

/** What Settings → Scoring shows: the choice and the key's state, never the key. */
export type ScoringView = { scorer: Scorer; keyState: ScoringKeyState };

export const SCORER_INFO: Record<Scorer, { name: string; description: string; tag: string }> = {
  AI: {
    name: "Your AI model",
    description: "The AI provider in Settings → AI provider scores each posting and writes why it fits, in its own words.",
    tag: "Uses your AI provider",
  },
  JEV: {
    name: "Jev by TypeSafe",
    description: "A model made for quick judgments. It answers questions about the posting, and Dossier builds the score and the reasons from the posting's own lines.",
    tag: "Needs a TypeSafe key",
  },
};

export const TYPESAFE_KEY_URL = "https://console.typesafe.ai/keys";

export const SCORING_KEY_MISSING = "Enter your TypeSafe key in Settings → Scoring first.";
export const SCORING_KEY_UNREADABLE = "Your saved TypeSafe key can't be read. Enter it again in Settings → Scoring.";
