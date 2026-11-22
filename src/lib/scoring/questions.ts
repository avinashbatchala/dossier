import { citationText } from "@/lib/citation";
import { experienceMonths, factTexts, formatDateRange, formatMonthYear, languageLevelLabel, paidRoles, type CustomSection, type ProfileData } from "@/lib/profile";
import { levelRangeLabel, type LevelRange } from "@/lib/profile-levels";
import { REMOTE_OPEN_TO, WORK_MODES, type Workplace } from "@/lib/profile-workplace";

import { LOCATION_FITS, SENIORITY_FITS, type FactorAnswers, type LevelAnswer, type LocationFit, type RequirementAnswer, type SeniorityFit } from "./factors";
import type { Answer, ChoiceQuestion, NoulQuestion, Question, ScoreQuestion } from "./typesafe";

// The six factors as typed questions (E25-1, #408), the same for every
// scoring model: a Score on a scale of levels, a Choice, or a yes-or-no
// (TypeSafe's Noul, OpenAI's predicate). Decision models answer them as they
// are; the AI model answers them as JSON, with a reason for each. Each factor
// reads its own part of the profile; the requirements read all of it.

/** What a profile is scored with: its sections, the levels it's for and where it wants to work. */
export type ScoringProfile = { data: ProfileData; levels: LevelRange; workplace: Workplace };

/** What's scored of a posting. */
export type ScoringPosting = { title: string; company: string; place: string; remote: boolean | null; salary: string; description: string };

/** A level of a Score: what it means, for the model, and what it says to the user once chosen. */
type Level = { means: string; says: string };
/** A Choice's option, alike. */
type Option = { means: string; says: string };

export const WORK_LEVELS: readonly Level[] = [
  { means: "Unrelated: the candidate's paid work is a different kind of work, in a different field.", says: "Your paid work so far is in a different field." },
  {
    means: "Loosely related: some overlap in tools or field, but the job's main work would be new to the candidate.",
    says: "Your paid work is loosely related: this job's main work would be new to you.",
  },
  { means: "Related: the candidate has done similar work, in another setting or with other tools.", says: "You've done similar work, in another setting or with other tools." },
  { means: "Closely matching: the candidate has done this kind of work before, in a comparable role.", says: "You've done this kind of work before, in a comparable role." },
];

export const EXTRA_LEVELS: readonly Level[] = [
  {
    means: "Nothing in the candidate's projects, volunteering, certifications, publications or other activities relates to the job, or there are none.",
    says: "None of your projects, volunteering, certifications or other activities relate to this job.",
  },
  { means: "Loosely related to the job.", says: "Some of your extra activities are loosely related to this job." },
  { means: "Related: they show skills or interests the job asks for.", says: "Your extra activities show skills or interests this job asks for." },
  {
    means: "Directly relevant: they show the job's main work, or a certification or publication it asks for.",
    says: "Your extra activities show this job's main work, or a credential it asks for.",
  },
];

export const EDUCATION_LEVELS: readonly Level[] = [
  { means: "The posting asks for a degree, level or field of study the candidate's education doesn't meet.", says: "The posting asks for education yours doesn't meet." },
  {
    means: "Partly: the candidate's education is in a related field, or a level below what the posting asks for.",
    says: "Your education partly meets what the posting asks for.",
  },
  {
    means: "The candidate's education meets what the posting asks for, or the posting asks for no particular education.",
    says: "Your education meets what the posting asks for, or it asks for none in particular.",
  },
];

const STEPS = "The levels, lowest first: Internship, Entry level, Mid level, Senior, Lead or director.";

export const SENIORITY_OPTIONS: Record<SeniorityFit, Option> = {
  "far-below": {
    means: "The job's level is two or more steps below the lowest of the candidate's levels, for example an entry-level role for a profile that's Senior to Lead or director.",
    says: "The role is far below the levels this profile is for.",
  },
  below: { means: "The job's level is one step below the lowest of the candidate's levels.", says: "The role is a step below the levels this profile is for." },
  fits: {
    means: "The job's level is within the candidate's levels, or the posting gives no sign of its level.",
    says: "The role's level is within the levels this profile is for.",
  },
  above: { means: "The job's level is one step above the highest of the candidate's levels.", says: "The role is a step above the levels this profile is for." },
  "far-above": {
    means: "The job's level is two or more steps above the highest of the candidate's levels, for example a lead role for a profile that's Entry level to Mid level.",
    says: "The role is far above the levels this profile is for.",
  },
};

export const LOCATION_OPTIONS: Record<LocationFit, Option> = {
  fits: {
    means: "The candidate can work where and how the job is: one of the ways of working they accept, in a place they accept, or remote for employers where they accept.",
    says: "You can work where and how this job is.",
  },
  stretch: {
    means: "Possible, but not quite as the candidate wants: a little beyond their radius, a move they're willing to make, or the posting is unclear about where the job is.",
    says: "Where this job is would take a stretch, or the posting is unclear about it.",
  },
  cannot: {
    means: "The job needs something the candidate doesn't accept: on-site or hybrid somewhere they won't work or move to, remote only for employers in places they don't accept, or a work permit their profile doesn't show.",
    says: "This job is somewhere this profile can't work.",
  },
};

const scoreQuestion = (instructions: string, levels: readonly Level[]): ScoreQuestion => ({ type: "score", instructions, criteria: levels.map((level) => level.means) });
const choiceQuestion = (instructions: string, options: Record<string, Option>): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria: Object.fromEntries(Object.entries(options).map(([value, option]) => [value, option.means])),
});

const WORK: ScoreQuestion = scoreQuestion(
  "How close is the paid work in `candidate.workExperience` to the day-to-day work of the job in `posting`?",
  WORK_LEVELS,
);
const EXTRA: ScoreQuestion = scoreQuestion(
  "How much do the candidate's extra activities in `candidate.extraActivities` (projects, volunteering, certifications, publications and other sections) support them for the job in `posting`?",
  EXTRA_LEVELS,
);
const EDUCATION: ScoreQuestion = scoreQuestion("How well does `candidate.education` meet what `posting` asks for in education?", EDUCATION_LEVELS);
const SENIORITY: ChoiceQuestion = choiceQuestion(
  `Where is the level of the job in \`posting\` (its title, seniority, scope and the years it asks for) against \`candidate.seniority.levels\`, the levels the candidate is looking for? ${STEPS} Use the roles' titles and years in \`candidate.seniority\` only to read an unclear posting.`,
  SENIORITY_OPTIONS,
);
const LOCATION: ChoiceQuestion = choiceQuestion(
  "Can the candidate work where and how the job in `posting` is, by `candidate.location`: where they live, the ways of working they accept, how far they'd go, where they'd work remotely for, whether they'd move, and their facts about work permits?",
  LOCATION_OPTIONS,
);
const THIN: NoulQuestion = {
  type: "noul",
  instructions: "Is `posting` too short or too vague to tell what the job requires of applicants?",
};

export const REQUIREMENT_KINDS = {
  must: {
    means: "A must-have: something applicants must bring, such as a skill, tool, kind or length of experience, degree, certificate, language or work permit the job requires.",
  },
  nice: { means: "A nice-to-have: something the job would like but doesn't require, for example marked as a plus, a bonus, preferred or ideally." },
  other: { means: "Not asked of applicants: about the company or the team, the job's tasks, benefits, pay, the hiring process or how to apply." },
} as const;
type RequirementKind = keyof typeof REQUIREMENT_KINDS;

const lineKind = (line: string): ChoiceQuestion => ({
  type: "choice",
  instructions: `This is a line from \`posting\`: "${line}". What is it?`,
  criteria: Object.fromEntries(Object.entries(REQUIREMENT_KINDS).map(([kind, { means }]) => [kind, means])),
});

const lineCovered = (line: string): NoulQuestion => ({
  type: "noul",
  instructions: `This is a line from \`posting\`: "${line}". Does \`candidate\` show what it asks for, anywhere in the profile: skills, languages, facts, work experience, extra activities or education?`,
  criteria: {
    true: "The candidate's profile shows it, directly or clearly.",
    false: "Nothing in the candidate's profile shows it, or only something loosely related.",
  },
});

/** The questions for one request: the posting's lines two by two, then the five factors and whether the posting is too thin. */
export function engineQuestions(lines: readonly string[]): Record<string, Question> {
  return {
    ...Object.fromEntries(
      lines.flatMap((line, index) => [
        [`line${index}Kind`, lineKind(line)],
        [`line${index}Covered`, lineCovered(line)],
      ]),
    ),
    work: WORK,
    extra: EXTRA,
    education: EDUCATION,
    seniority: SENIORITY,
    location: LOCATION,
    thin: THIN,
  };
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => citationText(line))
    .filter(Boolean);

function customEntries(sections: readonly CustomSection[], countsAs: CustomSection["countsAs"]) {
  return sections
    .filter((section) => section.countsAs === countsAs)
    .map((section) => ({
      section: section.title,
      items: section.items
        .filter((item) => item.title.trim() !== "" || item.details.trim() !== "")
        .map((item) =>
          section.format === "ENTRIES"
            ? { title: item.title, subtitle: item.subtitle, dates: formatDateRange(item), details: lines(item.details) }
            : citationText(item.title),
        ),
    }))
    .filter((section) => section.items.length > 0);
}

const yearsOf = (months: number) => Math.round((months / 12) * 10) / 10;

/**
 * What a scoring model reads, grouped by the factor that reads it (M4). Items
 * kept off resumes are in it too: hiding is about a resume's length, not
 * what's true. Never the name, contact details, references or links.
 */
export function scoringState(posting: ScoringPosting, { data: profile, levels, workplace }: ScoringProfile, today = new Date()) {
  const skillNames = new Map(profile.skills.map((skill) => [skill.id, skill.name]));
  const skillsOf = (ids: readonly string[]) => ids.flatMap((id) => skillNames.get(id) ?? []);
  const role = (entry: ProfileData["experience"][number]) => ({
    role: entry.role,
    company: entry.company,
    ...(entry.descriptor.trim() ? { about: entry.descriptor.trim() } : {}),
    location: entry.location,
    dates: formatDateRange(entry),
    bullets: lines(entry.bullets),
    skillsUsed: skillsOf(entry.skillIds),
  });
  const paid = paidRoles(profile.experience);
  const facts = factTexts(profile.facts);
  const { basics } = profile;
  return {
    posting: { title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, salary: posting.salary, text: posting.description.trim() },
    candidate: {
      headline: basics.headline,
      summary: basics.summary,
      skills: profile.skills.map((skill) => skill.name),
      languages: profile.languages.map((language) => `${language.name}: ${languageLevelLabel(language.level)}`),
      ...(facts.length > 0 ? { factsAboutMe: facts } : {}),
      workExperience: {
        roles: paid.map(role),
        ...(customEntries(profile.customSections, "WORK_EXPERIENCE").length > 0 ? { otherWork: customEntries(profile.customSections, "WORK_EXPERIENCE") } : {}),
      },
      extraActivities: {
        projects: profile.projects.map((entry) => ({ name: entry.name, dates: formatDateRange(entry), bullets: lines(entry.bullets), skillsUsed: skillsOf(entry.skillIds) })),
        volunteering: profile.experience.filter((entry) => entry.volunteering).map(role),
        certifications: profile.certifications
          .filter((entry) => entry.name.trim() !== "")
          .map((entry) => ({
            name: entry.name,
            issuer: entry.issuer,
            obtained: formatMonthYear(entry.year, entry.month),
            ...(entry.expiryYear === null ? {} : { validUntil: formatMonthYear(entry.expiryYear, entry.expiryMonth) }),
          })),
        publications: profile.publications.filter((entry) => entry.citation.trim() !== "").map((entry) => citationText(entry.citation)),
        otherActivities: customEntries(profile.customSections, "EXTRA_ACTIVITIES"),
      },
      education: {
        degrees: profile.education.map((entry) => ({ degree: entry.degree, school: entry.school, dates: formatDateRange(entry), notes: entry.notes })),
        ...(customEntries(profile.customSections, "EDUCATION").length > 0 ? { otherEducation: customEntries(profile.customSections, "EDUCATION") } : {}),
      },
      ...seniorityAndLocation({ data: profile, levels, workplace }, today),
    },
  };
}

/** The levels a profile is for and where it wants to work, as scoring models read them; the Claude connector's get_profile gives Claude the same. */
export function seniorityAndLocation({ data: profile, levels, workplace }: ScoringProfile, today = new Date()) {
  const { basics } = profile;
  return {
    seniority: {
      levels: levelRangeLabel(levels),
      // Models add up date ranges badly (#279): counted here, overlapping roles once.
      yearsOfPaidWork: yearsOf(experienceMonths(profile, today)),
      roles: paidRoles(profile.experience).map((entry) => ({ role: entry.role, dates: formatDateRange(entry) })),
    },
    location: {
      livesIn: [basics.city, basics.country].filter(Boolean).join(", "),
      waysOfWorking: workplace.modes.map((mode) => WORK_MODES.find((option) => option.value === mode)?.label ?? mode),
      ...(workplace.modes.some((mode) => mode !== "REMOTE")
        ? { onSiteOrHybrid: { withinKmOfHome: workplace.radiusKm, otherPlaces: workplace.otherPlaces } }
        : {}),
      ...(workplace.modes.includes("REMOTE")
        ? {
            remoteForEmployersIn:
              workplace.remoteOpenTo === "countries"
                ? workplace.remoteCountries.map((code) => code.toUpperCase())
                : (REMOTE_OPEN_TO.find((option) => option.value === workplace.remoteOpenTo)?.label ?? workplace.remoteOpenTo),
          }
        : {}),
      willingToMove: workplace.relocate ? (workplace.relocatePlaces.length > 0 ? workplace.relocatePlaces : true) : false,
    },
  };
}

/** A Score's answer as 0 to 1; Decisions' answers can fall between levels. */
const levelValue = (score: number, question: ScoreQuestion) => Math.min(1, Math.max(0, (Number.isFinite(score) ? score : 0) / (question.criteria.length - 1)));
/** What the nearest level says. */
const levelSays = (value: number, levels: readonly Level[]) => levels[Math.round(value * (levels.length - 1))].says;

/** A level answer with the model's reason, or the level's own words when it gave none. */
export function levelAnswer(value: number, levels: readonly Level[], reason?: string | null): LevelAnswer {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return { value: clamped, reason: reason?.trim() || levelSays(clamped, levels) };
}

/** A yes from a probability. */
const YES = 0.5;

/**
 * The answers of a decision model to `engineQuestions(lines)`, which give
 * no reasons: each factor's line says what its level means. One answer
 * missing or of the wrong kind means the answer can't be trusted: `fail` says how it fails.
 * Lines in `leftOut` (by index) aren't requirements: the model refused to read them (#516).
 */
export function answersFromTyped(
  answers: Record<string, Answer>,
  postingLines: readonly string[],
  fail: (detail: string) => Error,
  leftOut: ReadonlySet<number> = new Set(),
): FactorAnswers {
  const answer = <T extends Answer["type"]>(id: string, type: T) => {
    const found = answers[id];
    if (found?.type !== type) throw fail(`no ${type} answer for ${id}`);
    return found as Extract<Answer, { type: T }>;
  };
  const choice = <T extends string>(id: string, allowed: readonly T[]): T => {
    const { choice: value } = answer(id, "choice");
    if (!(allowed as readonly string[]).includes(value)) throw fail(`unknown choice for ${id}`);
    return value as T;
  };
  const requirements = postingLines.flatMap((text, index): RequirementAnswer[] => {
    if (leftOut.has(index)) return [];
    const kind = choice<RequirementKind>(`line${index}Kind`, Object.keys(REQUIREMENT_KINDS) as RequirementKind[]);
    const covered = answer(`line${index}Covered`, "noul").noul >= YES;
    return kind === "other" ? [] : [{ text, mustHave: kind === "must", covered, evidence: null }];
  });
  const seniority = choice("seniority", SENIORITY_FITS);
  const location = choice("location", LOCATION_FITS);
  return {
    requirements,
    work: levelAnswer(levelValue(answer("work", "score").score, WORK), WORK_LEVELS),
    extra: levelAnswer(levelValue(answer("extra", "score").score, EXTRA), EXTRA_LEVELS),
    education: levelAnswer(levelValue(answer("education", "score").score, EDUCATION), EDUCATION_LEVELS),
    seniority: { fit: seniority, reason: SENIORITY_OPTIONS[seniority].says },
    location: { fit: location, reason: LOCATION_OPTIONS[location].says },
    thin: answer("thin", "noul").noul >= YES,
  };
}
