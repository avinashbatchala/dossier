// Whether a word is a country's name, in any of the languages resumes here are
// usually written in (#371): "Germany", "Deutschland" and "USA" are; "Oregon"
// and "Bavaria" aren't. Built from the runtime's own region names, once.

const LOCALES = ["en", "de", "fr", "es", "it", "nl", "pt", "pl", "sv", "da", "nb", "fi", "cs", "sk", "sl", "hr", "hu", "ro", "bg", "el", "tr", "ru", "uk", "ar", "fa", "he", "hi", "id", "vi", "th", "zh", "ja", "ko"];

/** Short and old names people write that the region names don't have. */
const ALIASES = ["usa", "us", "u s", "u s a", "united states of america", "america", "uk", "u k", "great britain", "britain", "england", "scotland", "wales", "northern ireland", "uae", "holland", "czech republic", "ivory coast", "south korea", "korea"];

/** Not countries, though the region list has them. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "ZZ"]);

const key = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");

let names: Set<string> | null = null;

function countryNames(): Set<string> {
  if (names) return names;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const codes = [...letters].flatMap((first) => [...letters].map((second) => first + second)).filter((code) => !NOT_COUNTRIES.has(code));
  names = new Set(ALIASES.map(key));
  for (const locale of LOCALES) {
    const display = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
    for (const code of codes) {
      const name = display.of(code);
      if (name) names.add(key(name));
    }
  }
  return names;
}

/** Whether `value` names a country, forgiving case, accents, punctuation and a leading "the". */
export function isCountryName(value: string): boolean {
  return value.trim() !== "" && countryNames().has(key(value));
}
