import { COUNTRIES, countryCodeFor, countryName } from "@/lib/job-search/countries";

// Where a startup hires, read against the profile's city and country (#222),
// for users anywhere: whether a post names the city or the country, and
// whether its remote work is open to that country ("Remote (EU)", "Remote,
// US only", "remote, worldwide"). Hiring posts write places freely, so this
// is a careful guess: it says "doesn't say" rather than guess wrong.

const list = (codes: string) => codes.split(" ");

const EU = list("at be bg hr cy cz dk ee fi fr de gr hu ie it lv lt lu mt nl pl pt ro sk si es se");
const EUROPE = [...EU, ...list("al ad ax ba by ch fo gb gg gi im is je li mc md me mk no rs ru sj sm ua va xk")];
const CEE = list("al ba bg by cz ee hr hu lt lv md me mk pl ro rs ru si sk ua xk");
const NORTH_AMERICA = list("us ca mx");
const LATAM = list("mx bz cr gt hn ni pa sv ar bo br cl co ec gy pe py sr uy ve cu do ht jm pr tt bb bs ag dm gd kn lc vc aw cw");
const MIDDLE_EAST = list("ae bh cy eg il iq ir jo kw lb om ps qa sa sy tr ye");
const NORTH_AFRICA = list("dz eg ly ma tn sd");
const AFRICA = list("dz ao bj bw bf bi cv cm cf td km cd cg ci dj eg gq er sz et ga gm gh gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd tz tg tn ug zm zw eh re yt");
const SOUTH_ASIA = list("af bd bt in lk mv np pk");
const SOUTHEAST_ASIA = list("bn id kh la mm my ph sg th tl vn");
const EAST_ASIA = list("cn hk jp kp kr mn mo tw");
const ASIA = [...SOUTH_ASIA, ...SOUTHEAST_ASIA, ...EAST_ASIA, ...list("kz kg tj tm uz")];
const OCEANIA = list("au nz fj pg sb vu ws to ki fm mh nr pw tv nc pf ck nu");

/** Regions and time zones hiring posts name, with the countries in them. Abbreviations are matched in capitals only. */
const REGIONS: { name: string; words?: RegExp; caps?: RegExp; codes: string[] }[] = [
  { name: "the EU", words: /\beuropean union\b/i, caps: /\b(?:EU|EEA)\b/, codes: [...EU, "is", "li", "no"] },
  { name: "Europe", words: /\beurope(?:an)?\b/i, caps: /\b(?:CET|CEST|EET|EEST|WET)\b/, codes: EUROPE },
  { name: "EMEA", caps: /\bEMEA\b/, codes: [...EUROPE, ...MIDDLE_EAST, ...AFRICA] },
  { name: "DACH", caps: /\bDACH\b/, codes: list("de at ch") },
  { name: "the Nordics", words: /\b(?:nordics?|scandinavian?)\b/i, codes: list("dk fi is no se") },
  { name: "Benelux", words: /\bbenelux\b/i, codes: list("be nl lu") },
  { name: "Eastern Europe", words: /\b(?:central\s+(?:and|&)\s+)?eastern\s+europe\b/i, caps: /\bCEE\b/, codes: CEE },
  { name: "the UK", words: /\b(?:united\s+kingdom|britain|england|scotland|wales)\b/i, caps: /\bUK\b/, codes: ["gb"] },
  { name: "the UK and Ireland", caps: /\b(?:GMT|BST)\b/, codes: list("gb ie pt is") },
  { name: "the US", words: /\b(?:united\s+states|(?<!(?:latin|south|central|north)\s)america(?!s))\b/i, caps: /\bUSA?\b|\bU\.S\.|\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/, codes: ["us"] },
  { name: "North America", words: /\bnorth\s+american?\b/i, codes: NORTH_AMERICA },
  { name: "the Americas", words: /\bamericas\b/i, codes: [...NORTH_AMERICA, ...LATAM] },
  { name: "Latin America", words: /\b(?:latin|south|central)\s+american?\b|\blatam\b/i, codes: LATAM },
  { name: "Asia-Pacific", words: /\basia[-\s]?pacific\b/i, caps: /\bAPAC\b/, codes: [...ASIA, ...OCEANIA] },
  { name: "Southeast Asia", words: /\bsouth[-\s]?east\s+asia\b/i, codes: SOUTHEAST_ASIA },
  { name: "South Asia", words: /\bsouth\s+asia\b/i, codes: SOUTH_ASIA },
  { name: "East Asia", words: /\beast\s+asia\b/i, codes: EAST_ASIA },
  { name: "Asia", words: /\basian?\b/i, codes: ASIA },
  { name: "the Middle East", words: /\bmiddle\s+east\b|\bgulf\b/i, caps: /\b(?:MENA|GCC)\b/, codes: [...MIDDLE_EAST, ...NORTH_AFRICA] },
  { name: "Africa", words: /\bafrican?\b/i, codes: AFRICA },
  { name: "Australia and New Zealand", words: /\b(?:oceania|australasia)\b/i, caps: /\b(?:ANZ|AEST|AEDT|NZST)\b/, codes: OCEANIA },
  { name: "India", caps: /\bIST\b/, codes: ["in"] },
];

/** Remote work open to anyone, wherever they live. */
const ANYWHERE = /\b(?:anywhere|world\s?wide|global(?:ly)?|any\s+(?:country|location|time\s?zone))\b/i;
const REMOTE = /\b(?:remote(?:ly)?|wfh|work\s+from\s+home|home\s?office|distributed|t[ée]l[ée]travail|teletrabajo|remoto)\b/i;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordsPattern = (names: readonly string[]) => (names.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "u") : null);

/** Spellings of the same city, folded. */
const CITY_NAMES: string[][] = [
  ["bengaluru", "bangalore"],
  ["gurugram", "gurgaon"],
  ["mumbai", "bombay"],
  ["delhi", "new delhi", "ncr"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["munich", "munchen", "muenchen"],
  ["cologne", "koln", "koeln"],
  ["nuremberg", "nurnberg", "nuernberg"],
  ["dusseldorf", "duesseldorf"],
  ["vienna", "wien"],
  ["zurich", "zuerich"],
  ["geneva", "geneve", "genf"],
  ["prague", "praha"],
  ["warsaw", "warszawa"],
  ["krakow", "cracow"],
  ["lisbon", "lisboa"],
  ["copenhagen", "kobenhavn"],
  ["gothenburg", "goteborg"],
  ["rome", "roma"],
  ["milan", "milano"],
  ["turin", "torino"],
  ["florence", "firenze"],
  ["naples", "napoli"],
  ["seville", "sevilla"],
  ["athens", "athina"],
  ["bucharest", "bucuresti"],
  ["belgrade", "beograd"],
  ["brussels", "bruxelles", "brussel"],
  ["the hague", "den haag"],
  ["kyiv", "kiev"],
  ["beijing", "peking"],
  ["new york", "nyc"],
  ["san francisco", "sf", "bay area"],
  ["tel aviv", "tel aviv-yafo"],
  ["ho chi minh city", "saigon", "hcmc"],
  ["mexico city", "cdmx", "ciudad de mexico"],
  ["montreal"],
  ["sao paulo"],
  ["bogota"],
];

/** Country names too often something else in a hiring post: a US state, a first name. */
const AMBIGUOUS = new Set(["je", "ge", "jo", "td"]);
/** Country names people write that Intl doesn't give. */
const ALIASES: Record<string, string[]> = {
  us: ["usa", "united states of america"],
  gb: ["great britain"],
  nl: ["holland", "the netherlands"],
  cz: ["czech republic"],
  ae: ["uae"],
  kr: ["south korea", "korea"],
  tr: ["turkey"],
};
/** Names in the languages profiles are often written in, so "Deutschland" works like "Germany". */
const LOCALES = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "nb", "fi"];

let countryNames: Map<string, string> | undefined;

/** Every country's names, folded, to its code. */
function allCountryNames(): Map<string, string> {
  if (countryNames) return countryNames;
  countryNames = new Map();
  for (const locale of LOCALES) {
    const display = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    for (const { code } of COUNTRIES) {
      if (AMBIGUOUS.has(code)) continue;
      const name = display.of(code.toUpperCase());
      if (name && !countryNames.has(fold(name))) countryNames.set(fold(name), code);
    }
  }
  for (const [code, names] of Object.entries(ALIASES)) for (const name of names) countryNames.set(name, code);
  return countryNames;
}

let countryPattern: RegExp | null | undefined;

/** The codes of the countries a text names (as written in any of LOCALES). */
function countriesIn(folded: string): Set<string> {
  const names = allCountryNames();
  countryPattern ??= wordsPattern([...names.keys()].sort((a, b) => b.length - a.length));
  const found = new Set<string>();
  if (!countryPattern) return found;
  for (const match of folded.matchAll(new RegExp(countryPattern.source, "gu"))) {
    const name = match[0].replace(/^[^\p{L}\p{N}]/u, "");
    const code = names.get(name);
    if (code) found.add(code);
  }
  return found;
}

export type Place = {
  /** The profile's city as written, and its spellings, folded. */
  city: string;
  cityNames: string[];
  /** The profile's country as an ISO code ("de"), and its name in English; "" when it isn't one. */
  country: string;
  countryName: string;
};

/** The place to read posts against, from the profile's city and country. */
export function placeOf({ city, country }: { city: string; country: string }): Place {
  const name = fold(city.trim());
  const code = countryCodeFor(country);
  return {
    city: city.trim(),
    cityNames: name ? (CITY_NAMES.find((group) => group.includes(name)) ?? [name]) : [],
    country: code,
    countryName: code ? countryName(code) : country.trim(),
  };
}

export type Reach = {
  /** The profile's city is named, else its country; null for neither. */
  here: "city" | "country" | null;
  /** It mentions remote work. */
  remote: boolean;
  /** Remote work open to the profile's country: true when it says so, false when it names only other places, null when it doesn't say. */
  remoteOpen: boolean | null;
  /** The places remote work is limited to, when that leaves the profile's country out, e.g. "the US". */
  remoteOnly: string;
};

/** The places a part of a post names: country codes, and the names of the regions it uses. */
function placesIn(text: string): { codes: Set<string>; regions: string[]; anywhere: boolean } {
  const codes = countriesIn(fold(text));
  const regions: string[] = [];
  for (const region of REGIONS) {
    if (region.words?.test(text) || region.caps?.test(text)) {
      regions.push(region.name);
      for (const code of region.codes) codes.add(code);
    }
  }
  return { codes, regions, anywhere: ANYWHERE.test(text) };
}

/** Where a post or location hires, read against `place`. */
export function reach(text: string, place: Place): Reach {
  const folded = fold(text);
  const city = wordsPattern(place.cityNames);
  const here = city?.test(folded) ? "city" : place.country && countriesIn(folded).has(place.country) ? "country" : null;

  // The remote work's own conditions are in the part that says "remote":
  // "Berlin or REMOTE (EU)", "Remote (US only)", "SF; Remote".
  const parts = text.split(/[|;\n•·]+/).filter((part) => REMOTE.test(part));
  if (parts.length === 0) return { here, remote: ANYWHERE.test(text), remoteOpen: ANYWHERE.test(text) ? true : null, remoteOnly: "" };
  let remoteOpen: boolean | null = null;
  let remoteOnly = "";
  for (const part of parts) {
    const { codes, regions, anywhere } = placesIn(part);
    if (anywhere || (place.country && codes.has(place.country))) return { here, remote: true, remoteOpen: true, remoteOnly: "" };
    if (codes.size > 0 && place.country) {
      remoteOpen = false;
      remoteOnly ||= regions[0] ?? [...codes].slice(0, 3).map((code) => countryName(code)).join(", ");
    }
  }
  return { here, remote: true, remoteOpen, remoteOnly };
}
