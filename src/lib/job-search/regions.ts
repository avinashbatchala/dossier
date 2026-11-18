import { countryNames } from "./countries";

// Where a posting can be done from (E23, #239). Remote feeds and company
// boards return postings for every country, and say who may apply in a
// line: "Worldwide", "USA only", "LATAM, Europe", "Berlin, Germany",
// "San Francisco, CA". A posting is kept for a country when that line says
// nothing Dossier recognises, says anywhere, or names the country or a
// region it's in. Only a line that names places, none of them the country,
// drops it.

const EU = "at be bg hr cy cz dk ee fi fr de gr hu ie it lv lt lu mt nl pl pt ro sk si es se";
const EEA = `${EU} is li no`;
const EUROPE = `${EEA} al ad am az by ba ch fo gb ge gi gg im je md mc me mk rs ru sm tr ua va xk ax sj`;
const MIDDLE_EAST = "ae bh cy eg il iq ir jo kw lb om ps qa sa sy tr ye";
const NORTH_AFRICA = "dz eg ly ma sd tn eh";
const AFRICA =
  "dz ao bj bw bf bi cv cm cf td km cd cg ci dj eg gq er sz et ga gm gh gn gw ke ls lr ly mg mw ml mr mu ma mz na ne ng rw st sn sc sl so za ss sd tz tg tn ug zm zw eh re yt sh";
const NORTH_AMERICA = "us ca mx";
const CENTRAL_AMERICA = "bz cr sv gt hn ni pa";
const CARIBBEAN = "ag ai aw bb bl bq bs cu cw dm do gd gp ht jm kn ky lc mf mq ms pr sx tc tt vc vg vi";
const SOUTH_AMERICA = "ar bo br cl co ec fk gf gy pe py sr uy ve";
const LATIN_AMERICA = `mx ${CENTRAL_AMERICA} ${SOUTH_AMERICA} cu do pr ht`;
const AMERICAS = `${NORTH_AMERICA} ${CENTRAL_AMERICA} ${CARIBBEAN} ${SOUTH_AMERICA} gl bm pm`;
const EAST_ASIA = "cn hk mo tw jp kr kp mn";
const SOUTHEAST_ASIA = "bn kh id la my mm ph sg th tl vn";
const SOUTH_ASIA = "af bd bt in lk mv np pk";
const CENTRAL_ASIA = "kz kg tj tm uz";
const ASIA = `${EAST_ASIA} ${SOUTHEAST_ASIA} ${SOUTH_ASIA} ${CENTRAL_ASIA} ${MIDDLE_EAST} am az ge`;
const OCEANIA = "au nz fj pg sb vu nc pf ws to ki fm mh nr pw tv ck nu gu mp as";
const APAC = `${EAST_ASIA} ${SOUTHEAST_ASIA} ${SOUTH_ASIA} ${OCEANIA}`;

/** Regions as job postings write them, folded, to the countries in them. */
const REGIONS: Record<string, string> = {
  europe: EUROPE,
  "european union": EU,
  eu: EU,
  eea: EEA,
  emea: `${EUROPE} ${MIDDLE_EAST} ${AFRICA}`,
  "middle east": MIDDLE_EAST,
  mena: `${MIDDLE_EAST} ${NORTH_AFRICA}`,
  africa: AFRICA,
  "north africa": NORTH_AFRICA,
  "northern africa": NORTH_AFRICA,
  "north america": NORTH_AMERICA,
  americas: AMERICAS,
  latam: LATIN_AMERICA,
  "latin america": LATIN_AMERICA,
  "south america": SOUTH_AMERICA,
  "central america": CENTRAL_AMERICA,
  caribbean: CARIBBEAN,
  asia: ASIA,
  apac: APAC,
  "asia pacific": APAC,
  "east asia": EAST_ASIA,
  "southeast asia": SOUTHEAST_ASIA,
  "south east asia": SOUTHEAST_ASIA,
  "south asia": SOUTH_ASIA,
  "central asia": CENTRAL_ASIA,
  oceania: OCEANIA,
  anz: "au nz",
  dach: "de at ch",
  nordics: "dk fi is no se fo ax",
  nordic: "dk fi is no se fo ax",
  scandinavia: "dk no se",
  benelux: "be nl lu",
  baltics: "ee lv lt",
  "baltic states": "ee lv lt",
};

/** Names job postings use that the country list doesn't give. */
const MORE_NAMES: Record<string, string> = {
  us: "us",
  "u s": "us",
  "u s a": "us",
  "united states": "us",
  "u k": "gb",
  "russian federation": "ru",
  "syrian arab republic": "sy",
  palestine: "ps",
  congo: "cg cd",
  "democratic republic of the congo": "cd",
  "dr congo": "cd",
  "ivory coast": "ci",
  "cote d ivoire": "ci",
  myanmar: "mm",
  burma: "mm",
  "hong kong": "hk",
  macao: "mo",
  macau: "mo",
  bosnia: "ba",
  trinidad: "tt",
  "sao tome": "st",
  "cabo verde": "cv",
  "holy see": "va",
  swaziland: "sz",
  "viet nam": "vn",
  turkey: "tr",
  lao: "la",
  laos: "la",
  // The country, and the state with Atlanta in it.
  georgia: "ge us",
};

// US states and Canada's provinces, for a board's "Austin, Texas". Georgia is the country's.
const US_STATES =
  "alabama alaska arizona arkansas california colorado connecticut delaware florida hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia washington wisconsin wyoming";
const US_STATES_TWO_WORDS = ["new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "rhode island", "south carolina", "south dakota", "west virginia", "district of columbia"];
const CA_PROVINCES = ["ontario", "quebec", "british columbia", "alberta", "manitoba", "saskatchewan", "nova scotia", "new brunswick", "newfoundland", "prince edward island"];

// "San Francisco, CA", "Toronto, ON": a state's or province's code after a comma.
const US_CODES = new Set(
  "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY".split(" "),
);
const CA_CODES = new Set("AB BC MB NB NL NS ON PE QC SK".split(" "));

/** Anywhere goes. */
const ANYWHERE = / (worldwide|world wide|anywhere|global|globally|international|everywhere|all countries|any country|any location|all locations) /;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

let table: { pattern: RegExp; codes: Map<string, Set<string>> } | undefined;

/** Every place name, longest first, so "new mexico" isn't read as Mexico or "latin america" as America. */
function places(): NonNullable<typeof table> {
  if (table) return table;
  const codes = new Map<string, Set<string>>();
  const add = (name: string, list: string) => {
    const set = codes.get(name) ?? new Set<string>();
    for (const code of list.split(" ")) set.add(code);
    codes.set(name, set);
  };
  for (const [name, code] of countryNames()) add(name, code);
  for (const [name, list] of Object.entries({ ...MORE_NAMES, ...REGIONS })) add(name, list);
  for (const state of [...US_STATES.split(" "), ...US_STATES_TWO_WORDS]) add(state, "us");
  for (const province of CA_PROVINCES) add(province, "ca");
  const names = [...codes.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  table = { pattern: new RegExp(`(?<= )(?:${names.join("|")})(?= )`, "g"), codes };
  return table;
}

/**
 * Whether a posting whose place reads `place` can be done from the country
 * with `country`'s code. Kept unless the place names countries or regions,
 * none of them that country.
 */
export function workableFrom(place: string, country: string): boolean {
  const code = country.toLowerCase();
  const text = ` ${fold(place)} `;
  if (!code || text.trim() === "" || ANYWHERE.test(text)) return true;
  let named = false;
  for (const [, state] of place.matchAll(/,\s*([A-Z]{2})\s*(?=$|[\s(,/–-])/g)) {
    // A code that's a country's too ("Berlin, DE") counts as both.
    const country = US_CODES.has(state) ? "us" : CA_CODES.has(state) ? "ca" : null;
    if (!country) continue;
    named = true;
    if (code === country || code === state.toLowerCase()) return true;
  }
  const { pattern, codes } = places();
  for (const [name] of text.matchAll(pattern)) {
    named = true;
    if (codes.get(name)?.has(code)) return true;
  }
  return !named;
}
