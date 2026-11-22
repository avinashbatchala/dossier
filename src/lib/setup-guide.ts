import { z } from "zod";

// The setup guide (E21): a few steps at /welcome that get a fresh install
// ready, for people who have never seen an API key.

export const SETUP_STEPS = ["start", "ai", "jobs", "scoring", "google", "profile", "done"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** The steps in the guide's rail; Start and Done are the ends around them. */
export const SETUP_RAIL: readonly { step: Exclude<SetupStep, "start" | "done">; name: string }[] = [
  { step: "ai", name: "AI" },
  { step: "jobs", name: "Job search" },
  { step: "scoring", name: "Scoring" },
  { step: "google", name: "Gmail and Calendar" },
  { step: "profile", name: "Profile" },
];

/** Where the guide was left, and whether it's finished or was left for good. Saved in Settings as `setupGuide`. */
export const setupGuideSchema = z.object({ step: z.enum(SETUP_STEPS), finished: z.boolean() });
export type SetupGuideState = z.infer<typeof setupGuideSchema>;

export const setupHref = (step: SetupStep) => `/welcome?step=${step}`;

/** The step in `?step=`, or where the guide was left, or the start. */
export function setupStepFromParam(value: string | string[] | undefined, saved: SetupGuideState | null): SetupStep {
  const asked = SETUP_STEPS.find((step) => step === value);
  if (asked) return asked;
  return saved && !saved.finished ? saved.step : "start";
}

export function nextSetupStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.min(SETUP_STEPS.indexOf(step) + 1, SETUP_STEPS.length - 1)];
}

export function previousSetupStep(step: SetupStep): SetupStep {
  return SETUP_STEPS[Math.max(SETUP_STEPS.indexOf(step) - 1, 0)];
}

/**
 * Whether the guide opens by itself: only on a fresh install, never opened
 * before, with no name in the profile and no applications. After that it's
 * opened from Settings → About or the dashboard.
 */
export function opensSetupGuide({ guide, name, applications }: { guide: SetupGuideState | null; name: string; applications: number }): boolean {
  return guide === null && !name.trim() && applications === 0;
}

/** Opened and neither finished nor left: other questions, such as the usage ping, wait. */
export function setupInProgress(guide: SetupGuideState | null): boolean {
  return guide !== null && !guide.finished;
}
