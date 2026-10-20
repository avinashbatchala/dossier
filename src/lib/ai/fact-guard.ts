import type { Extracted, Unit } from "@/lib/application-data";
import { experienceMonths, formatDateRange, languageLevelLabel, type ProfileData } from "@/lib/profile";

// The fact guard (E6-6, PRD §7, §12 "zero invented facts"): after each
// generation, the names, numbers, percentages, years and credentials in the
// text are checked against the profile and the posting. What can't be found
// is stored with the unit and shown as "check this" (E8-3). It's a safety
// net for strict mode, tuned to stay quiet about what's legitimately there.

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};

const MONTHS_AND_DAYS = new Set(
  [
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ],
);

// Capitalised mid-sentence, but not names.
const NOT_NAMES = new Set(["i", "i'm", "i’m", "i've", "i’ve", "i'd", "i’d", "i'll", "i’ll", "ok"]);

// Credentials said in words rather than as an acronym.
const CREDENTIAL = /\b(certified|certification|certificate|licensed|license|accredited|chartered)\b/gi;

// A number as people write it: "4,000+", "4 000", "120k", "30%", "2.5", "12".
const NUMBER = /(?<![\p{L}\p{N}])(\d{1,3}(?:[,.\u00A0\u202F ]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|m)?%?(?![\p{L}\p{N}])/giu;

/** A number's value, whatever its formatting: "4,000+" and "4000" are the same. */
function numberValue(digits: string, suffix: string | undefined): number {
  const thousands = /^\d{1,3}(?:[,.\u00A0\u202F ]\d{3})+$/.test(digits);
  const value = thousands ? Number(digits.replace(/[^\d]/g, "")) : Number(digits.replace(",", "."));
  const scale = suffix?.toLowerCase() === "k" ? 1_000 : suffix?.toLowerCase() === "m" ? 1_000_000 : 1;
  return value * scale;
}

function numbersIn(text: string): { raw: string; value: number }[] {
  const found = [...text.matchAll(NUMBER)].map((match) => ({ raw: match[0].trim(), value: numberValue(match[1], match[2]) }));
  for (const match of text.matchAll(/\b([a-z]+)\b/gi)) {
    const value = NUMBER_WORDS[match[1].toLowerCase()];
    if (value !== undefined) found.push({ raw: match[1], value });
  }
  return found;
}

/** Everything a claim may be backed by, lowercased for word lookups. */
export type FactSources = { text: string; words: Set<string>; numbers: Set<number> };

export function factSources(parts: string[]): FactSources {
  const text = parts.join("\n").toLowerCase();
  return {
    text,
    words: new Set(text.match(/[\p{L}\p{N}][\p{L}\p{N}&'’.+#-]*/gu)?.map((word) => word.replace(/[.'’]+$/, "")) ?? []),
    numbers: new Set(numbersIn(text).map((number) => number.value)),
  };
}

/** The profile and posting as fact sources, plus the years of experience the profile adds up to. */
export function sourcesFor(profile: ProfileData, extracted: Extracted | null, posting: string, experienceYears?: number): FactSources {
  const { basics } = profile;
  const parts = [
    basics.name, basics.headline, basics.city, basics.country, basics.summary,
    ...profile.skills.map((skill) => skill.name),
    ...profile.languages.map((language) => `${language.name} ${languageLevelLabel(language.level)}`),
    ...profile.experience.flatMap((entry) => [entry.role, entry.company, entry.location, formatDateRange(entry), entry.bullets]),
    ...profile.projects.flatMap((entry) => [entry.name, entry.link, formatDateRange(entry), entry.bullets]),
    ...profile.education.flatMap((entry) => [entry.degree, entry.school, formatDateRange(entry), entry.notes]),
    ...profile.references.flatMap((reference) => [reference.name, reference.relation, reference.company]),
    extracted ? [extracted.title, extracted.company, extracted.role, extracted.location, extracted.mode, extracted.salary].filter(Boolean).join(" ") : "",
    posting,
    experienceYears === undefined ? "" : String(experienceYears),
  ];
  return factSources(parts);
}

/** Where sentences start: capitals there are grammar, not names. */
function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>([0]);
  for (const match of text.matchAll(/(?:[.!?:;]["”’)]?\s+|\n)\s*(?:[-*•·]\s+)?(?=\S)/g)) starts.add(match.index + match[0].length);
  return starts;
}

/**
 * What in `text` the sources don't back: names and acronyms, numbers
 * (including years and percentages) and credentials, in order, once each.
 */
export function unverifiedFacts(text: string, sources: FactSources): string[] {
  const flags: string[] = [];
  const flag = (value: string) => {
    if (!flags.includes(value)) flags.push(value);
  };

  // Names: capitalised words that don't start a sentence, and acronyms anywhere.
  const starts = sentenceStarts(text);
  for (const match of text.matchAll(/[\p{Lu}][\p{L}\p{N}&'’+#-]*/gu)) {
    const word = match[0].replace(/['’]s$/, "").replace(/[-'’]+$/, "");
    const lower = word.toLowerCase();
    // Two capitals or more (PhD, MBA, UX) mark an acronym or credential, even at a sentence's start.
    const acronym = (word.match(/\p{Lu}/gu)?.length ?? 0) >= 2;
    if (starts.has(match.index) && !acronym) continue;
    if (NOT_NAMES.has(lower) || MONTHS_AND_DAYS.has(lower)) continue;
    if (sources.words.has(lower) || sources.text.includes(lower)) continue;
    flag(word);
  }

  // Numbers, years and percentages, however they're formatted.
  for (const number of numbersIn(text)) {
    if (sources.numbers.has(number.value)) continue;
    // "one of the…", "a single…" aren't claims.
    if (/^[a-z]+$/i.test(number.raw) && number.value <= 2) continue;
    flag(number.raw);
  }

  // Credentials in words: "certified", "licensed"…
  for (const match of text.matchAll(CREDENTIAL)) {
    if (!sources.text.includes(match[1].toLowerCase().slice(0, 7))) flag(match[1]);
  }
  return flags;
}

/**
 * Checks each unit and notes what couldn't be backed on the unit itself.
 * Units built from the profile in code (skills, languages, the sign-off)
 * aren't checked.
 */
export function guardUnits(units: Unit[], sources: FactSources): Unit[] {
  return units.map(({ id, label, text }) => {
    const unit = { id, label, text };
    if (["skills", "languages", "sign-off"].includes(id)) return unit;
    const unverified = unverifiedFacts(text, sources);
    return unverified.length > 0 ? { ...unit, unverified } : unit;
  });
}

/** The sources for checking a generation for this profile and posting. */
export function guardSources(profile: ProfileData, extracted: Extracted | null, posting: string, today = new Date()): FactSources {
  return sourcesFor(profile, extracted, posting, Math.floor(experienceMonths(profile, today) / 12));
}
