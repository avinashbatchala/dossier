// The scoring models (#274, E25-2): each one definition here, for the server,
// Settings → Scoring, the setup guide and the Usage screen alike. The server
// side of each (how it scores, how it's tested) is in src/lib/scoring/models.ts.

export const SCORERS = ["AI", "JEV", "DECISIONS", "OPENROUTER"] as const;
export type Scorer = (typeof SCORERS)[number];

/** Each scoring model's row on the Usage screen (#290), in this order there. */
export const SCORER_USAGE = [
  { task: "score-posting", label: "Scoring postings", hint: "Score in Positions and the job agent, with your AI model" },
  { task: "score-posting-jev", label: "Scoring postings with Jev", hint: "The same, by TypeSafe's Jev" },
  { task: "score-posting-decisions", label: "Scoring postings with OpenAI Decisions", hint: "The same, by OpenAI Decisions" },
  { task: "score-posting-openrouter", label: "Scoring postings with OpenRouter", hint: "The same, by a model on OpenRouter" },
] as const;
type UsageRow = (typeof SCORER_USAGE)[number];

/** The OpenRouter model that scores until another is chosen (E25-4): cheap, and it holds answers to a JSON schema. */
export const OPENROUTER_SCORING_MODEL = "openai/gpt-6-luna";

/** Like the job sources' keys: saved here, from an environment variable, missing, or saved under another DOSSIER_SECRET. */
export type ScoringKeyState = "none" | "set" | "unreadable" | "env";

/**
 * A scoring model's own key: the setting it's saved in, encrypted, the
 * variable that can set it instead (null for none), and where to get one.
 */
type ScorerKey = {
  label: string;
  setting: "typesafeKeyEnc" | "decisionsKeyEnc" | "openrouterScoringKeyEnc";
  envName: "DOSSIER_TYPESAFE_KEY" | null;
  getKey: { href: string; text: string };
};

/** What the setup guide says about a scoring model with a key of its own (E25-8). */
type ScorerSetup = {
  cost: string;
  data: string;
  steps: { text: string; link?: { href: string; label: string } }[];
  /** Its section on the wiki's page about AI providers. */
  wikiAnchor: string;
};

export type ScorerInfo = {
  name: string;
  description: string;
  tag: string;
  usage: UsageRow;
  /** Null for the AI model, which uses Settings → AI provider. */
  key: ScorerKey | null;
  /** What it's sent, shown when it's chosen; null when that's the AI provider's. */
  privacy: string | null;
  /** What its connection test does, while it runs. */
  testing: string;
  /** For the setup guide; null for the AI model. */
  setup: ScorerSetup | null;
};

const PROFILE_SENT = "with the profile it's scored against, without your name, contact details, references or links";

export const SCORER_INFO: Record<Scorer, ScorerInfo> = {
  AI: {
    name: "Your AI model",
    description: "The AI provider in Settings → AI provider answers the scoring questions and says why, in its own words.",
    tag: "Uses your AI provider",
    usage: SCORER_USAGE[0],
    key: null,
    privacy: null,
    testing: "Asking your AI model for one word…",
    setup: null,
  },
  JEV: {
    name: "Jev by TypeSafe",
    description: "A model made for quick judgments. It answers the same questions without writing anything, so each factor says what its answer means.",
    tag: "Needs a TypeSafe key",
    usage: SCORER_USAGE[1],
    key: { label: "TypeSafe key", setting: "typesafeKeyEnc", envName: "DOSSIER_TYPESAFE_KEY", getKey: { href: "https://console.typesafe.ai/keys", text: "the TypeSafe console" } },
    privacy: `Each posting you score goes to TypeSafe ${PROFILE_SENT}. Jev reads English best: postings in other languages are judged less well.`,
    testing: "Asking Jev one short question…",
    setup: {
      cost: "You pay TypeSafe for each posting it reads. It's in early access, so a new account may have to wait for a key.",
      data: `Each posting you score goes to TypeSafe ${PROFILE_SENT}. TypeSafe doesn't train on it. Jev reads English best.`,
      steps: [{ text: "Sign up for TypeSafe, then open the console's keys and create one.", link: { href: "https://console.typesafe.ai/keys", label: "the TypeSafe console" } }, { text: "Copy the key and paste it below." }],
      wikiAnchor: "scoring-with-jev",
    },
  },
  DECISIONS: {
    name: "OpenAI Decisions",
    description: "OpenAI's API for typed judgments. It answers the same questions without writing anything, so each factor says what its answer means.",
    tag: "Needs an OpenAI key",
    usage: SCORER_USAGE[2],
    key: { label: "OpenAI key", setting: "decisionsKeyEnc", envName: null, getKey: { href: "https://platform.openai.com/api-keys", text: "OpenAI's API keys page" } },
    privacy: `Each posting you score goes to OpenAI ${PROFILE_SENT}, to its Decisions API with the gpt-6-luna model.`,
    testing: "Asking OpenAI Decisions one short question…",
    setup: {
      cost: "You pay OpenAI for what each posting reads, at a low price per token; its answers cost nothing.",
      data: `Each posting you score goes to OpenAI ${PROFILE_SENT}. OpenAI doesn't train on what its API is sent.`,
      steps: [
        { text: "Sign in to OpenAI's platform, and add a payment method if your account has none.", link: { href: "https://platform.openai.com", label: "OpenAI's platform" } },
        { text: "Create an API key, and paste it below.", link: { href: "https://platform.openai.com/api-keys", label: "OpenAI's API keys page" } },
      ],
      wikiAnchor: "scoring-with-openai-decisions",
    },
  },
  OPENROUTER: {
    name: "OpenRouter",
    description: "A model of your choice on OpenRouter answers the scoring questions and says why, apart from the AI that writes your documents.",
    tag: "Needs an OpenRouter key",
    usage: SCORER_USAGE[3],
    key: { label: "OpenRouter key", setting: "openrouterScoringKeyEnc", envName: null, getKey: { href: "https://openrouter.ai/settings/keys", text: "OpenRouter's keys page" } },
    privacy: `Each posting you score goes to OpenRouter and the company behind the model you chose, ${PROFILE_SENT}. Dossier asks OpenRouter to use only companies that don't keep or train on it.`,
    testing: "Asking the model on OpenRouter for one word…",
    setup: {
      cost: "You pay OpenRouter for what each posting reads and what the model answers, at the model's price.",
      data: `Each posting you score goes to OpenRouter and the model's company ${PROFILE_SENT}. Dossier asks it to skip companies that keep or train on it.`,
      steps: [
        { text: "Sign in to OpenRouter and add credits.", link: { href: "https://openrouter.ai", label: "OpenRouter" } },
        { text: "Create a key, and paste it below.", link: { href: "https://openrouter.ai/settings/keys", label: "OpenRouter's keys page" } },
      ],
      wikiAnchor: "scoring-with-openrouter",
    },
  },
};

/** The settings that hold scoring models' keys: never exported, and kept on import. */
export const SCORER_KEY_SETTINGS: readonly string[] = SCORERS.flatMap((scorer) => SCORER_INFO[scorer].key?.setting ?? []);

/** What Settings → Scoring shows: the choice, each key's state (never a key) and OpenRouter's model. */
export type ScoringView = { scorer: Scorer; keys: Partial<Record<Scorer, ScoringKeyState>>; openrouterModel: string };

export const scorerKeyMissing = (scorer: Scorer) => `Enter your ${SCORER_INFO[scorer].key?.label ?? "key"} in Settings → Scoring first.`;
export const scorerKeyUnreadable = (scorer: Scorer) => `Your saved ${SCORER_INFO[scorer].key?.label ?? "key"} can't be read. Enter it again in Settings → Scoring.`;
