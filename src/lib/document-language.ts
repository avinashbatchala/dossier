// The languages documents can be written in (SET-7) and what the renderer
// needs from them: a BCP 47 tag for `lang` (which also picks the right
// Chinese, Japanese or Korean glyphs) and the writing direction.

export type TextDirection = "ltr" | "rtl";

type LanguageInfo = { name: string; tag: string; dir?: TextDirection };

/** The built-in "Write documents in" list, in the prototype's order (`DOC_LANGS`). */
export const DOCUMENT_LANGUAGES: readonly LanguageInfo[] = [
  { name: "English", tag: "en" },
  { name: "Dutch", tag: "nl" },
  { name: "German", tag: "de" },
  { name: "French", tag: "fr" },
  { name: "Spanish", tag: "es" },
  { name: "Italian", tag: "it" },
  { name: "Portuguese", tag: "pt" },
  { name: "Polish", tag: "pl" },
  { name: "Swedish", tag: "sv" },
  { name: "Danish", tag: "da" },
  { name: "Norwegian", tag: "no" },
  { name: "Finnish", tag: "fi" },
  { name: "Czech", tag: "cs" },
  { name: "Greek", tag: "el" },
  { name: "Turkish", tag: "tr" },
  { name: "Arabic", tag: "ar", dir: "rtl" },
  { name: "Persian", tag: "fa", dir: "rtl" },
  { name: "Hindi", tag: "hi" },
  { name: "Chinese (Simplified)", tag: "zh-Hans" },
  { name: "Japanese", tag: "ja" },
  { name: "Korean", tag: "ko" },
];

/** Languages people may add with "Other language…" that are written right to left. */
const OTHER_RIGHT_TO_LEFT: readonly LanguageInfo[] = [
  { name: "Farsi", tag: "fa", dir: "rtl" },
  { name: "Hebrew", tag: "he", dir: "rtl" },
  { name: "Urdu", tag: "ur", dir: "rtl" },
  { name: "Pashto", tag: "ps", dir: "rtl" },
  { name: "Dari", tag: "prs", dir: "rtl" },
  { name: "Kurdish (Sorani)", tag: "ckb", dir: "rtl" },
  { name: "Sindhi", tag: "sd", dir: "rtl" },
  { name: "Uyghur", tag: "ug", dir: "rtl" },
  { name: "Yiddish", tag: "yi", dir: "rtl" },
  { name: "Dhivehi", tag: "dv", dir: "rtl" },
];

// Letters of scripts written right to left: Hebrew, Arabic, Syriac, Thaana, N'Ko…
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const RIGHT_TO_LEFT_LETTERS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/gu;
const LETTERS = /\p{L}/gu;

const count = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

/** Whether text contains right-to-left letters. */
export function hasRightToLeft(text: string): boolean {
  return RIGHT_TO_LEFT.test(text);
}

/** The direction most of the text's letters are written in. */
export function detectDirection(text: string): TextDirection {
  const rightToLeft = count(text, RIGHT_TO_LEFT_LETTERS);
  return rightToLeft > count(text, LETTERS) - rightToLeft ? "rtl" : "ltr";
}

/**
 * A language tag when most of the text is in a script only one of the
 * built-in languages uses, so a Chinese company name in an English resume
 * doesn't make it Chinese.
 */
function detectTag(text: string): string | undefined {
  const letters = count(text, LETTERS);
  const han = count(text, /\p{Script=Han}/gu);
  const kana = count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = count(text, /\p{Script=Hangul}/gu);
  const most = (n: number) => n > letters / 2;
  // Japanese mixes kana with kanji, and Korean can use hanja.
  if (hangul > 0 && most(hangul + han)) return "ko";
  if (kana > 0 && most(kana + han)) return "ja";
  if (most(han)) return "zh-Hans";
  if (most(count(text, /\p{Script=Devanagari}/gu))) return "hi";
  if (most(count(text, /\p{Script=Greek}/gu))) return "el";
  return undefined;
}

/** A language by its name, from the list or one of the right-to-left ones it knows ("Farsi"). */
export function knownLanguage(language: string | null | undefined): LanguageInfo | undefined {
  const name = language?.trim().toLowerCase();
  return name ? [...DOCUMENT_LANGUAGES, ...OTHER_RIGHT_TO_LEFT].find((entry) => entry.name.toLowerCase() === name) : undefined;
}

/**
 * The `lang` and `dir` for a document written in `language` (a name from
 * the list, or one added with "Other language…"). Without a language, or
 * for one it doesn't know, it looks at the text instead, as for the base
 * resume, which is in whatever language the profile is.
 */
export function documentLanguage(
  language: string | null | undefined,
  sample: string,
): { lang?: string; dir: TextDirection } {
  const known = knownLanguage(language);
  if (known) return { lang: known.tag, dir: known.dir ?? "ltr" };
  return { lang: detectTag(sample), dir: detectDirection(sample) };
}
