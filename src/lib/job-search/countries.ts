// Countries for job search (E14-6): the choice in the search form, and the
// profile's country, typed as a name, matched to its ISO 3166-1 code.

// Every assigned alpha-2 code, plus XK (Kosovo), which job sites use too.
const CODES = (
  "ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz " +
  "ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr " +
  "ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp " +
  "ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt " +
  "mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw " +
  "sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug " +
  "um us uy uz va vc ve vg vi vn vu wf ws xk ye yt za zm zw"
).split(" ");

const englishNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });

/** "Germany" for "de"; the code itself when it isn't one. */
export function countryName(code: string): string {
  if (!/^[a-z]{2}$/i.test(code)) return code;
  return englishNames.of(code.toUpperCase()) ?? code.toUpperCase();
}

export type Country = { code: string; name: string };

/**
 * Every country, by English name, for the search form. Build it on the
 * server and pass it down: a browser's ICU data can name a few differently.
 */
export const COUNTRIES: readonly Country[] = CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
  a.name.localeCompare(b.name, "en"),
);

// Names people write that the locales below don't give.
const ALIASES: Record<string, string> = {
  usa: "us",
  "united states of america": "us",
  america: "us",
  uk: "gb",
  "great britain": "gb",
  britain: "gb",
  england: "gb",
  scotland: "gb",
  wales: "gb",
  "northern ireland": "gb",
  holland: "nl",
  "the netherlands": "nl",
  "czech republic": "cz",
  uae: "ae",
  "south korea": "kr",
  korea: "kr",
  russia: "ru",
  turkey: "tr",
};

// Names in the languages of the countries job sources cover best, so
// "Deutschland" or "Österreich" in a profile works as well as "Germany".
const LOCALES = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "nb", "fi"];

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

let byName: Map<string, string> | undefined;

/** Every country's names, folded ("deutschland", "united states"), to its code. */
export function countryNames(): ReadonlyMap<string, string> {
  return names();
}

function names(): Map<string, string> {
  if (byName) return byName;
  byName = new Map(Object.entries(ALIASES));
  for (const locale of LOCALES) {
    const display = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    for (const code of CODES) {
      const name = display.of(code.toUpperCase());
      if (name && !byName.has(fold(name))) byName.set(fold(name), code);
    }
  }
  return byName;
}

/** The code for a country as people write it ("Germany", "Deutschland", "DE", "USA"); "" when it isn't one. */
export function countryCodeFor(text: string): string {
  const folded = fold(text);
  if (!folded) return "";
  if (/^[a-z]{2}$/.test(folded) && CODES.includes(folded)) return folded;
  return names().get(folded) ?? "";
}
