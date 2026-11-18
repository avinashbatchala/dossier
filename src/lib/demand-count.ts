// What employers ask for (E33-3): the skills in the postings a profile was
// scored against, counted without AI. A skill's name is normalised (case,
// accents, punctuation and a short list of synonyms) so "React.js" and
// "react" count as one. The parts here are pure, for the server to count and
// for the Profile page to work out what's covered as the profile changes.

/** Spellings that mean the same skill, by their normalised form. */
const SYNONYMS: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  k8s: "kubernetes",
  postgres: "postgresql",
  "react js": "react",
  reactjs: "react",
  "node js": "node",
  nodejs: "node",
  "vue js": "vue",
  vuejs: "vue",
  "next js": "nextjs",
  golang: "go",
  gcp: "google cloud",
  "google cloud platform": "google cloud",
  aws: "amazon web services",
  a11y: "accessibility",
  "ux research": "user research",
  "ci cd": "ci/cd",
  ml: "machine learning",
};

/** A skill's name, normalised for counting: "React.js" and " react " are both "react". */
export function skillKey(name: string): string {
  const plain = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    // Keeps what tells skills apart: C++, C#, CI/CD.
    .replace(/[^\p{L}\p{N}+#/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return SYNONYMS[plain] ?? plain;
}

/** One skill a posting asks for, and whether the profile covered it when it was scored (null when that isn't known). */
export type Ask = { skill: string; covered: boolean | null };
/** A posting or application, newest first, with what it asks for. */
export type DemandSource = { company: string; asks: readonly Ask[] };

/** A skill as counted: how many postings ask for it, and how the scores answered. */
export type DemandItem = {
  key: string;
  /** The spelling most postings use. */
  name: string;
  /** The postings that ask for it. */
  count: number;
  /** Of those, the scores that found it covered or missing in the profile. */
  coveredVotes: number;
  gapVotes: number;
  /** Who asks, newest first, each once. */
  companies: string[];
};

/** What a profile's postings ask for (E33-3), most asked first; `postings` counts those that ask for any skill. */
export type Demand = { postings: number; items: DemandItem[] };

/** Counts each skill once per posting. */
export function countDemand(sources: readonly DemandSource[]): Demand {
  const items = new Map<string, DemandItem & { spellings: Map<string, number> }>();
  let postings = 0;
  for (const source of sources) {
    const seen = new Map<string, { name: string; covered: boolean | null }>();
    for (const ask of source.asks) {
      const name = ask.skill.trim();
      const key = skillKey(name);
      if (!key) continue;
      const before = seen.get(key);
      // Covered anywhere in the posting counts as covered.
      seen.set(key, { name: before?.name ?? name, covered: before?.covered === true || ask.covered === true ? true : (before?.covered ?? ask.covered) });
    }
    if (seen.size === 0) continue;
    postings += 1;
    const company = source.company.trim();
    for (const [key, { name, covered }] of seen) {
      const item = items.get(key) ?? { key, name, count: 0, coveredVotes: 0, gapVotes: 0, companies: [] as string[], spellings: new Map<string, number>() };
      item.count += 1;
      if (covered === true) item.coveredVotes += 1;
      if (covered === false) item.gapVotes += 1;
      if (company && !item.companies.includes(company)) item.companies.push(company);
      item.spellings.set(name, (item.spellings.get(name) ?? 0) + 1);
      items.set(key, item);
    }
  }
  return {
    postings,
    items: [...items.values()]
      .map(({ spellings, ...item }) => ({ ...item, name: [...spellings].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0] }))
      .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** The sheet and the card show from this many postings up (E33-3); fewer say too little. */
export const DEMAND_MIN_POSTINGS = 5;

/** A counted skill with whether the profile covers it now. */
export type AskedFor = DemandItem & { covered: boolean };

/**
 * Whether the profile covers each skill: it lists it (a skill or a language,
 * by its normalised name), or most scores that asked found it. Skills marked
 * "I don't have this" are left out.
 */
export function askedFor(demand: Demand, { known, hidden }: { known: readonly string[]; hidden: readonly string[] }): AskedFor[] {
  const listed = new Set(known.map(skillKey));
  const left = new Set(hidden);
  return demand.items.flatMap((item) => {
    const covered = listed.has(item.key) || (item.coveredVotes > 0 && item.coveredVotes >= item.gapVotes);
    return !covered && left.has(item.key) ? [] : [{ ...item, covered }];
  });
}

/** "In 5 postings · Ledgerly, Adyen, Finch Ledger" */
export function askedNote(item: Pick<DemandItem, "count" | "companies">, companies = 3): string {
  const postings = item.count === 1 ? "In 1 posting" : `In ${item.count} postings`;
  const names = item.companies.slice(0, companies).join(", ");
  return names ? `${postings} · ${names}${item.companies.length > companies ? "…" : ""}` : postings;
}
