// The lines of a posting that Jev judges one by one (#274): its bullets and
// sentences, with lines a source wrapped at a fixed width joined again (the
// Bundesagentur für Arbeit wraps at about 75 characters). Reasons quote
// them, so they stay as the posting wrote them.

/** Enough for any requirements list; each line costs two questions. */
export const MAX_LINES = 40;
const MIN_LENGTH = 8;
const MAX_LENGTH = 300;
/** A line at least this long that doesn't end a sentence was wrapped by the source. */
const WRAP_WIDTH = 60;

const BULLET = /^(?:[-*•·▪◦●‣–—✓✔→]|\d{1,2}[.)])\s+/u;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;
const ENDS_SENTENCE = /[.!?:;]["'”’)]*$/u;
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[\p{Lu}\d"“])/u;

type Item = { text: string; bullet: boolean };

/** Markdown emphasis and the dashes some sources put around bold text ("-Ihre Aufgaben:-"). */
function clean(text: string): string {
  let line = text.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
  if (/^-\S/.test(line) && /\S-$/.test(line)) line = line.slice(1, -1).trim();
  return line;
}

/** A line cut to `MAX_LENGTH` at a word, with an ellipsis. */
function shorten(line: string): string {
  if (line.length <= MAX_LENGTH) return line;
  const cut = line.slice(0, MAX_LENGTH - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > MAX_LENGTH / 2 ? cut.lastIndexOf(" ") : cut.length).trimEnd()}…`;
}

/** The posting's bullets and paragraphs, each wrapped line joined to the one it continues. */
function items(text: string): Item[] {
  const found: Item[] = [];
  for (const block of text.replace(INVISIBLE, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let current: Item | null = null;
    let previousLength = 0;
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const bullet = BULLET.test(line);
      const body = line.replace(BULLET, "");
      const continues = current && !bullet && !ENDS_SENTENCE.test(current.text) && (/^\p{Ll}/u.test(body) || previousLength >= WRAP_WIDTH);
      if (current && continues) current.text += ` ${body}`;
      else found.push((current = { text: body, bullet }));
      previousLength = line.length;
    }
  }
  return found;
}

/**
 * The lines worth a question: bullets and sentences of two words or more
 * ("Fluent German"), without headings ("Your profile:") or repeats. Past
 * `MAX_LINES`, bullets win over sentences from paragraphs, which are more
 * often about the company; the posting's order is kept.
 */
export function postingLines(text: string): string[] {
  const seen = new Set<string>();
  const lines: Item[] = [];
  for (const item of items(text)) {
    const pieces = item.text.length > MAX_LENGTH ? item.text.split(SENTENCE_BREAK) : [item.text];
    for (const piece of pieces) {
      const line = shorten(clean(piece));
      const key = line.toLowerCase();
      if (line.length < MIN_LENGTH || line.endsWith(":") || line.split(" ").length < 2 || seen.has(key)) continue;
      seen.add(key);
      lines.push({ text: line, bullet: item.bullet });
    }
  }
  if (lines.length <= MAX_LINES) return lines.map((line) => line.text);
  const kept = new Set(lines.toSorted((a, b) => Number(b.bullet) - Number(a.bullet)).slice(0, MAX_LINES));
  return lines.filter((line) => kept.has(line)).map((line) => line.text);
}
