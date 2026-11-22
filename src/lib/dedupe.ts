import { linkKey } from "@/lib/job-search/search";

// The same job on several portals (E22-6, #392): careful matching in four
// layers, cheapest first, never AI. A wrong merge hides a job from the user,
// which is worse than a duplicate, so two postings from different cities or
// companies, or for different levels, are never the same job.

/** What a posting is compared by, stored on it (Posting.match*) so a new one is matched with one query. */
type MatchKeys = { link: string; company: string; title: string; city: string };

const LEGAL_FORMS = new Set([
  "gmbh", "ag", "se", "kg", "kgaa", "ug", "ohg", "ev", "mbh", "co", "cie",
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "plc", "corp", "corporation", "company",
  "bv", "nv", "vof", "sa", "sas", "sarl", "srl", "spa", "sl", "sau", "oy", "oyj", "ab", "as", "asa", "aps", "pty", "pte", "kk",
  "group", "holding", "holdings",
]);

/** Gender tags on titles: "(m/w/d)", "(f/m/x)", "(all genders)", "m/f/d", "(h/f)". */
const GENDER_TAGS = /\(\s*(?:[mwfdxhn]\s*[/|,]\s*){1,3}[mwfdxhn]\s*\)|\b(?:[mwfdxhn]\s*\/\s*){1,3}[mwfdxhn]\b|\(\s*all\s+genders?\s*\)|\(\s*gn\s*\)|\*\s*in\b/gi;

/** Words that say a level: postings for different levels are different jobs. */
const LEVEL_WORDS = new Set([
  "intern", "internship", "trainee", "praktikum", "praktikant", "praktikantin", "werkstudent", "werkstudentin", "working", "student", "apprentice", "ausbildung",
  "junior", "jr", "entry", "graduate", "associate", "einsteiger",
  "mid", "intermediate",
  "senior", "sr", "lead", "principal", "staff", "head", "director", "chief", "vp", "manager", "teamleiter", "leiter",
]);

const words = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** "Zalando SE", "Acme GmbH & Co. KG" and "zalando", "acme": legal forms at the end and punctuation drop out. */
export function companyKey(company: string): string {
  const list = words(company);
  while (list.length > 1 && (LEGAL_FORMS.has(list.at(-1)!) || list.at(-1) === "and")) list.pop();
  return list.join(" ");
}

/** "Senior Frontend Engineer (m/w/d)" and "Senior Frontend Engineer" are one title. */
export function titleKey(title: string): string {
  return words(title.replace(GENDER_TAGS, " ")).join(" ");
}

/** "10115 Berlin, Germany", "Berlin / Hybrid" and "Berlin" are one city: the place's first part, without postcodes. */
export function cityKey(place: string): string {
  const first = place.split(/[,/•|(]| - /)[0] ?? "";
  return words(first)
    .filter((word) => !/^\d+$/.test(word))
    .join(" ");
}

/** Job boards and search engines: a link to one of these isn't the employer's own. */
const BOARDS = new Set([
  "linkedin", "indeed", "stepstone", "glassdoor", "monster", "xing", "adzuna", "jooble", "ziprecruiter", "careerjet", "kununu",
  "welcometothejungle", "arbeitsagentur", "freehire", "simplyhired", "jobware", "dice", "wellfound", "otta", "google", "bing",
]);

/** Whether a link goes to a job board rather than the employer (its careers site or applicant system). */
export function isBoardLink(url: string): boolean {
  try {
    const labels = new URL(url).hostname.toLowerCase().split(".");
    return labels.slice(0, -1).some((label) => BOARDS.has(label));
  } catch {
    return false;
  }
}

/** The level words in a title. */
function levelsOf(title: string): string {
  return words(title)
    .filter((word) => LEVEL_WORDS.has(word))
    .toSorted()
    .join(" ");
}

function matchKeys(posting: { url: string; company: string; title: string; place: string }): MatchKeys {
  return { link: linkKey(posting.url), company: companyKey(posting.company), title: titleKey(posting.title), city: cityKey(posting.place) };
}

/** How much two texts share, from 0 to 1: the overlap of their three-word runs. */
export function textOverlap(a: string, b: string): number {
  const runs = (text: string) => {
    const list = words(text.slice(0, 4000));
    const set = new Set<string>();
    for (let index = 0; index + 2 < list.length; index++) set.add(`${list[index]} ${list[index + 1]} ${list[index + 2]}`);
    return set;
  };
  const first = runs(a);
  const second = runs(b);
  if (first.size === 0 || second.size === 0) return 0;
  let shared = 0;
  for (const run of first) if (second.has(run)) shared++;
  return shared / Math.min(first.size, second.size);
}

/** Whether every word of the shorter title is in the other: "senior frontend engineer" and "senior frontend engineer react", not "senior backend engineer". */
function titleWithin(a: string, b: string): boolean {
  const [shorter, longer] = [a, b].map((title) => new Set(title.split(" ").filter(Boolean))).toSorted((x, y) => x.size - y.size);
  if (shorter.size === 0) return false;
  for (const word of shorter) if (!longer.has(word)) return false;
  return true;
}

export type Comparable = { url: string; company: string; title: string; place: string; remote: boolean | null; description: string };

/**
 * Which layer says two postings are the same job, or null when none does
 * (layer 1, the same portal and id, is the posting's own key and never gets
 * here). Never across companies or cities, or between levels.
 */
export function sameJob(a: Comparable, b: Comparable): 2 | 3 | 4 | null {
  const one = matchKeys(a);
  const other = matchKeys(b);
  if (!one.company || one.company !== other.company) return null;
  if (one.city && other.city && one.city !== other.city) return null;
  if (levelsOf(a.title) !== levelsOf(b.title)) return null;
  // 2: the employer's own apply link, tracking parameters aside; with one title within the other, since some sites give every job one careers page.
  if (one.link && one.link === other.link && titleWithin(one.title, other.title)) return 2;
  // 3: the same title in the same city (or both remote, with no city).
  const sameCity = one.city ? one.city === other.city : !other.city && a.remote === true && b.remote === true;
  if (one.title && one.title === other.title && sameCity) return 3;
  // 4: one title within the other and mostly the same description, in the same city.
  if (sameCity && titleWithin(one.title, other.title) && a.description.length >= 200 && b.description.length >= 200 && textOverlap(a.description, b.description) >= 0.8) return 4;
  return null;
}
