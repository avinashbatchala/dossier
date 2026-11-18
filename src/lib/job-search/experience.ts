import { experienceRangeAskedFor, type ExperienceLevel, type SearchQuery } from "./search";

// The experience level a posting is for (public issue 59), read from its
// title and the years it asks for, so a search for one level leaves out the
// postings clearly for another. No source filters by level the way Dossier
// means it, and a posting that doesn't say stays in.

type Level = Exclude<ExperienceLevel, "any">;

const TITLE: [RegExp, Level][] = [
  [/\b(intern|interns|internship|praktikant(?:in)?|praktikum|werkstudent(?:in)?|working student|stagiair|trainee)\b/i, "intern"],
  [/\b(junior|jr\.?|entry[- ]level|graduate|associate|einsteiger|berufseinsteiger)\b/i, "junior"],
  [/\b(lead|principal|staff|head|director|vp|vice president|chief|cto|ceo|cfo|coo|teamleiter(?:in)?|leiter(?:in)?)\b/i, "lead"],
  [/\b(senior|sr\.?)\b/i, "senior"],
];

/** "3+ years", "5-7 years of experience", "mindestens 3 Jahre": the least years asked for, or null. */
const YEARS = /\b(\d{1,2})(?:\s*(?:\+|-|–|to|bis|à)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?|jahren?|jaar|ans|años)\b/gi;
// No boundary in front: German and Dutch compound it ("Berufserfahrung", "werkervaring").
const AROUND_EXPERIENCE = /(experience|erfahrung|ervaring|expérience|experiencia|track record|background)/i;

/** The fewest years of experience a posting asks for, or null when it names none. */
export function yearsAskedFor(description: string): number | null {
  let least: number | null = null;
  for (const match of description.matchAll(YEARS)) {
    // Only years near the word "experience": "3 years ago" or "2 years of warranty" don't count.
    const around = description.slice(Math.max(0, match.index - 60), match.index + match[0].length + 60);
    if (!AROUND_EXPERIENCE.test(around)) continue;
    const years = Number(match[1]);
    if (years > 30) continue;
    least = least === null ? years : Math.min(least, years);
  }
  return least;
}

/** The level a posting is for: by its title first, else by the years it asks for; null when it doesn't say. */
export function experienceLevelOf(posting: { title: string; description: string }): Level | null {
  for (const [pattern, level] of TITLE) if (pattern.test(posting.title)) return level;
  const years = yearsAskedFor(posting.description);
  if (years === null) return null;
  return years <= 1 ? "junior" : years < 5 ? "mid" : "senior";
}

/** Whether a posting may be shown for the levels a search asks for: it is for one of them, or doesn't say. */
export function fitsExperience(posting: { title: string; description: string }, query: Pick<SearchQuery, "experience" | "experienceTo">): boolean {
  const asked = experienceRangeAskedFor(query);
  if (!asked) return true;
  const level = experienceLevelOf(posting);
  return level === null || asked.includes(level);
}
