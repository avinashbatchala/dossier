// The scoring engine's six factors (E25-1, #408): what every scoring model
// judges, and how Dossier adds the answers up. The model judges each factor;
// code only weighs the answers, applies the caps and words the breakdown.

export const FACTORS = [
  { id: "requirements", label: "Requirements", weight: 35 },
  { id: "work", label: "Work experience", weight: 25 },
  { id: "seniority", label: "Seniority", weight: 15 },
  { id: "location", label: "Location", weight: 10 },
  { id: "education", label: "Education", weight: 10 },
  { id: "extra", label: "Extra activities", weight: 5 },
] as const;

type FactorId = (typeof FACTORS)[number]["id"];

/** A must-have counts this many times a nice-to-have inside the Requirements factor (decided 15 November). */
const MUST_HAVE_WEIGHT = 3;

/** The caps (M3): the most a score can be when one of these holds. */
const CAPS = { oneMustHaveMissing: 69, mustHavesMissing: 49, seniorityGap: 69, location: 49, thin: 60 } as const;

/** The job's level against the profile's levels: within them, a step off, or far off, either way. */
export const SENIORITY_FITS = ["far-below", "below", "fits", "above", "far-above"] as const;
export type SeniorityFit = (typeof SENIORITY_FITS)[number];

/** Whether the profile can work where the job is. */
export const LOCATION_FITS = ["fits", "stretch", "cannot"] as const;
export type LocationFit = (typeof LOCATION_FITS)[number];

/**
 * One requirement of the posting, as the scoring model sorted and judged it:
 * `evidence` is what covers it and `skill` the skill it's about, when the
 * model names them (the AI model does; decision models don't).
 */
export type RequirementAnswer = { text: string; mustHave: boolean; covered: boolean; evidence: string | null; skill?: string | null };

/** A factor judged on a scale: 0 (its lowest level) to 1 (its highest), and why, when the model says. */
export type LevelAnswer = { value: number; reason: string };

/** Every answer a scoring model gives, whichever model it is. */
export type FactorAnswers = {
  requirements: RequirementAnswer[];
  work: LevelAnswer;
  extra: LevelAnswer;
  education: LevelAnswer;
  seniority: { fit: SeniorityFit; reason: string };
  location: { fit: LocationFit; reason: string };
  /** The posting says too little to judge. */
  thin: boolean;
};

/** One line of the breakdown: the factor's points out of its weight, and why. `max` is 0 for a factor that couldn't be judged. */
export type FactorLine = { factor: FactorId; points: number; max: number; reason: string };

/** How a score adds up (E25-6): the factors in order, requirements first, the cap that held it down, and each requirement. */
export type Breakdown = { factors: FactorLine[]; cap: { at: number; reason: string } | null; requirements: RequirementAnswer[] };

const SENIORITY_VALUE: Record<SeniorityFit, number> = { "far-below": 0, below: 0.5, fits: 1, above: 0.5, "far-above": 0 };
const LOCATION_VALUE: Record<LocationFit, number> = { fits: 1, stretch: 0.5, cannot: 0 };

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const weightOf = (id: FactorId) => FACTORS.find((factor) => factor.id === id)!.weight;

/** “Kubernetes”, “Go” and “AWS” */
function listed(items: readonly string[]): string {
  const quoted = items.map((item) => `“${shortened(item)}”`);
  return quoted.length <= 1 ? (quoted[0] ?? "") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/** A requirement short enough for a line on screen. */
function shortened(text: string, max = 80): string {
  const line = text.trim().replace(/\s+/g, " ");
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

/** The Requirements factor's share (0 to 1), or null when the posting lists none. */
export function requirementsValue(requirements: readonly RequirementAnswer[]): number | null {
  let total = 0;
  let covered = 0;
  for (const requirement of requirements) {
    const weight = requirement.mustHave ? MUST_HAVE_WEIGHT : 1;
    total += weight;
    if (requirement.covered) covered += weight;
  }
  return total === 0 ? null : covered / total;
}

function requirementsReason(requirements: readonly RequirementAnswer[]): string {
  if (requirements.length === 0) return "Not counted: the posting lists no requirements, so the other factors make up the score.";
  const count = (mustHave: boolean) => {
    const of = requirements.filter((requirement) => requirement.mustHave === mustHave);
    return { all: of.length, covered: of.filter((requirement) => requirement.covered).length };
  };
  const must = count(true);
  const nice = count(false);
  const part = (counted: { all: number; covered: number }, one: string, many: string) => `${counted.covered} of ${counted.all} ${counted.all === 1 ? one : many}`;
  const parts = [must.all > 0 ? part(must, "must-have", "must-haves") : "", nice.all > 0 ? part(nice, "nice-to-have", "nice-to-haves") : ""].filter(Boolean);
  return `You show ${parts.join(" and ")}.`;
}

/** The lowest cap that holds, and why, or null. */
function capFor(answers: FactorAnswers): { at: number; reason: string } | null {
  const missing = answers.requirements.filter((requirement) => requirement.mustHave && !requirement.covered).map((requirement) => requirement.text);
  const caps: { at: number; reason: string }[] = [];
  if (missing.length === 1) caps.push({ at: CAPS.oneMustHaveMissing, reason: `${listed(missing)} is a must-have you don't show.` });
  if (missing.length > 1) caps.push({ at: CAPS.mustHavesMissing, reason: `${missing.length} must-haves you don't show: ${listed(missing.slice(0, 3))}${missing.length > 3 ? " and more" : ""}.` });
  if (answers.seniority.fit === "far-above") caps.push({ at: CAPS.seniorityGap, reason: "The role is far above the levels this profile is for." });
  if (answers.seniority.fit === "far-below") caps.push({ at: CAPS.seniorityGap, reason: "The role is far below the levels this profile is for." });
  if (answers.location.fit === "cannot") caps.push({ at: CAPS.location, reason: "The job is somewhere this profile can't work." });
  if (answers.thin) caps.push({ at: CAPS.thin, reason: "The posting says too little to judge." });
  return caps.reduce<{ at: number; reason: string } | null>((lowest, cap) => (lowest === null || cap.at < lowest.at ? cap : lowest), null);
}

/**
 * Adds the answers up (M3): each factor's share of its weight, over the
 * weights of the factors that could be judged, as 0 to 100; then the lowest
 * cap that holds. The breakdown names the cap only when it lowered the score.
 */
export function addUp(answers: FactorAnswers): { score: number; breakdown: Breakdown } {
  const requirements = requirementsValue(answers.requirements);
  const values: Record<FactorId, number | null> = {
    requirements,
    work: clamp(answers.work.value),
    seniority: SENIORITY_VALUE[answers.seniority.fit],
    location: LOCATION_VALUE[answers.location.fit],
    education: clamp(answers.education.value),
    extra: clamp(answers.extra.value),
  };
  const reasons: Record<FactorId, string> = {
    requirements: requirementsReason(answers.requirements),
    work: answers.work.reason,
    seniority: answers.seniority.reason,
    location: answers.location.reason,
    education: answers.education.reason,
    extra: answers.extra.reason,
  };
  let points = 0;
  let max = 0;
  const factors = FACTORS.map(({ id }): FactorLine => {
    const value = values[id];
    if (value === null) return { factor: id, points: 0, max: 0, reason: reasons[id] };
    const weight = weightOf(id);
    points += value * weight;
    max += weight;
    return { factor: id, points: Math.round(value * weight * 10) / 10, max: weight, reason: reasons[id] };
  });
  const uncapped = max === 0 ? 0 : Math.round((points / max) * 100);
  const cap = capFor(answers);
  const score = cap ? Math.min(uncapped, cap.at) : uncapped;
  return { score, breakdown: { factors, cap: cap && uncapped > cap.at ? cap : null, requirements: answers.requirements } };
}

/** "Capped at 69: “Kubernetes” is a must-have you don't show." */
export const capLine = (cap: { at: number; reason: string }) => `Capped at ${cap.at}: ${cap.reason}`;

/** A factor's line as text, for lists that show reasons as plain lines: "Requirements 30/35: You show 5 of 6 must-haves." */
export function factorText(line: FactorLine): string {
  const { label } = FACTORS.find((factor) => factor.id === line.factor)!;
  return line.max === 0 ? `${label}: ${line.reason}` : `${label} ${Math.round(line.points)}/${line.max}: ${line.reason}`;
}

/** The breakdown as score-posting's reasons and red flags, for screens and stores that keep plain lines (the agent's drafts, the connector). */
export function fitLines(breakdown: Breakdown): { reasons: string[]; redFlags: string[] } {
  const missing = breakdown.requirements.filter((requirement) => requirement.mustHave && !requirement.covered);
  return {
    reasons: breakdown.factors.map(factorText),
    redFlags: [...(breakdown.cap ? [capLine(breakdown.cap)] : []), ...missing.slice(0, 3).map((requirement) => `Missing: ${shortened(requirement.text, 160)}`)].slice(0, 4),
  };
}
