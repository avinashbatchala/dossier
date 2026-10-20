import { LanguageLevel } from "@/generated/prisma/enums";

/** Proficiency levels in the order the language select lists them (PRD PRO-4). */
export const LANGUAGE_LEVELS: readonly { value: LanguageLevel; label: string }[] = [
  { value: LanguageLevel.NATIVE, label: "Native" },
  { value: LanguageLevel.C2, label: "Fluent (C2)" },
  { value: LanguageLevel.C1, label: "Advanced (C1)" },
  { value: LanguageLevel.B2, label: "Upper intermediate (B2)" },
  { value: LanguageLevel.B1, label: "Intermediate (B1)" },
  { value: LanguageLevel.A2, label: "Elementary (A2)" },
  { value: LanguageLevel.A1, label: "Beginner (A1)" },
];

export function languageLevelLabel(level: LanguageLevel): string {
  return LANGUAGE_LEVELS.find((option) => option.value === level)?.label ?? level;
}

/** The dates of an experience, project or education entry. Months are 1–12. */
export type DateSpan = {
  startYear: number | null;
  startMonth: number | null;
  endYear: number | null;
  endMonth: number | null;
  /** Still ongoing ("Present"); the end date is ignored. */
  current: boolean;
};

type DateFormatOptions = {
  /** Locale for month names, e.g. the document's language. */
  locale?: string;
  /** Word for an ongoing entry. */
  present?: string;
};

/**
 * "Mar 2021", or "2013" without a month, or "" without a year, in the
 * locale's own order and digits ("2021年3月", "سپتامبر ۲۰۲۱").
 */
export function formatMonthYear(
  year: number | null,
  month: number | null,
  { locale = "en-US" }: DateFormatOptions = {},
): string {
  if (year === null) return "";
  // The profile's dates are Gregorian, even where the locale's calendar isn't (Persian).
  return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, {
    year: "numeric",
    month: month === null ? undefined : "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, (month ?? 1) - 1, 1));
}

/** "Mar 2021 – Present", "2013 – 2015", "Sep 2015 – May 2018", or a single date. */
export function formatDateRange(span: DateSpan, options: DateFormatOptions = {}): string {
  const start = formatMonthYear(span.startYear, span.startMonth, options);
  const end = span.current
    ? (options.present ?? "Present")
    : formatMonthYear(span.endYear, span.endMonth, options);
  return [start, end].filter(Boolean).join(" – ");
}

/** The Basics fields in the form's order (PRO-1); the section count is "filled/11". */
export const BASICS_FIELDS = [
  "name",
  "headline",
  "email",
  "phone",
  "dob",
  "website",
  "address",
  "city",
  "country",
  "linkedin",
  "summary",
] as const;
export type BasicsField = (typeof BASICS_FIELDS)[number];

// The profile as the editor works with it: plain values (dates of birth as
// "YYYY-MM-DD"), loaded by loadProfile() in src/lib/profile-data.ts.

export type Basics = Record<BasicsField, string> & { showAge: boolean };

// The basics are stored in the ProfileField table, one text row per filled-in
// field: text as typed, the date of birth as "YYYY-MM-DD", showAge as "true".

/** The keys in the ProfileField table. */
export const PROFILE_KEYS = [...BASICS_FIELDS, "showAge"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

/** The basics from ProfileField rows; a missing key is empty, and keys it doesn't know are ignored. */
export function basicsFromFields(rows: readonly { key: string; value: string }[]): Basics {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const basics = Object.fromEntries(BASICS_FIELDS.map((field) => [field, values.get(field) ?? ""]));
  return { ...(basics as Record<BasicsField, string>), showAge: values.get("showAge") === "true" };
}

/** The value to store for each key, or null for an empty one, whose row is removed. */
export function fieldsFromBasics(basics: Basics): Record<ProfileKey, string | null> {
  const fields = Object.fromEntries(BASICS_FIELDS.map((field) => [field, basics[field] || null]));
  return { ...(fields as Record<BasicsField, string | null>), showAge: basics.showAge ? "true" : null };
}

export type SkillItem = { id: string; name: string };
export type LanguageItem = { id: string; name: string; level: LanguageLevel };
export type ExperienceItem = DateSpan & {
  id: string;
  role: string;
  company: string;
  location: string;
  bullets: string;
  skillIds: string[];
};
/** A project (PRO-13): what was built, where to see it, and the skills used, like a role. */
export type ProjectItem = DateSpan & {
  id: string;
  name: string;
  link: string;
  bullets: string;
  skillIds: string[];
};
export type EducationItem = DateSpan & { id: string; degree: string; school: string; notes: string };
export type ReferenceItem = {
  id: string;
  name: string;
  relation: string;
  company: string;
  email: string;
  phone: string;
};
export type ProfileData = {
  basics: Basics;
  skills: SkillItem[];
  languages: LanguageItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
  references: ReferenceItem[];
};

/** How many Basics fields have something in them. */
export function filledBasics(basics: Record<BasicsField, string>): number {
  return BASICS_FIELDS.filter((field) => basics[field].trim() !== "").length;
}

/** Age in whole years on `today`, from a "YYYY-MM-DD" date of birth; null without a valid one. */
export function ageOn(dob: string, today: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  let age = today.getFullYear() - year;
  const beforeBirthday =
    today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * Profile strength (PRO-9): filled Basics fields ÷ 11 × 40, plus 25 for any
 * experience, 15 for any education, 12 for any skills and 8 for any references.
 */
export function profileStrength(profile: {
  basics: Record<BasicsField, string>;
  experience: number;
  education: number;
  skills: number;
  references: number;
}): { percent: number; hint: string } {
  const percent = Math.round(
    (filledBasics(profile.basics) / BASICS_FIELDS.length) * 40 +
      (profile.experience > 0 ? 25 : 0) +
      (profile.education > 0 ? 15 : 0) +
      (profile.skills > 0 ? 12 : 0) +
      (profile.references > 0 ? 8 : 0),
  );
  const hint =
    percent >= 90
      ? "Looking great. The AI has plenty to work with."
      : percent >= 50
        ? "Nice progress. A bit more detail makes tailoring sharper."
        : "A good start. Experience matters most.";
  return { percent, hint };
}

/**
 * Orders entries newest first by start date (entries without one go last),
 * then by their `sort` value.
 */
export function byStartDateDesc(
  a: DateSpan & { sort: number },
  b: DateSpan & { sort: number },
): number {
  const key = (entry: DateSpan) =>
    entry.startYear === null ? -Infinity : entry.startYear * 12 + (entry.startMonth ?? 0);
  return key(b) - key(a) || a.sort - b.sort;
}

/** How experience, projects and education are ordered (E4-9): by date until an entry is moved by hand. */
export type EntryOrder = "date" | "manual";

/** The entries in the section's order, as a new array. */
export function inEntryOrder<T extends DateSpan & { sort: number }>(entries: readonly T[], order: EntryOrder): T[] {
  return entries.toSorted(order === "manual" ? (a, b) => a.sort - b.sort : byStartDateDesc);
}

/** Whether two skill or language names are the same, ignoring case ("Figma" and "figma"). */
export function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;
}

/** Months of experience in the profile, counting overlapping roles once. */
export function experienceMonths(profile: Pick<ProfileData, "experience">, today: Date): number {
  const now = today.getFullYear() * 12 + today.getMonth();
  const months = new Set<number>();
  for (const entry of profile.experience) {
    if (entry.startYear === null) continue;
    const start = entry.startYear * 12 + (entry.startMonth ?? 1) - 1;
    const end = entry.current
      ? now
      : entry.endYear !== null
        ? entry.endYear * 12 + (entry.endMonth ?? 12) - 1
        : start;
    for (let month = start; month <= Math.min(end, now); month++) months.add(month);
  }
  return months.size;
}
