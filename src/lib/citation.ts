// A publication's citation (#218) is written in the user's own style, with
// **bold** and *italic* marked like that. A mark only counts at the edge of a
// word: it opens at the start, after a space or an opening bracket or quote,
// with text right after it, and closes after text, before a space,
// punctuation or the end. So an asterisk on a name for equal contribution,
// as in "Dombrowe, V.*", stays an asterisk, and "\*" is always one.

/** A run of a citation's text, bold, italic or both. */
export type CitationSpan = { text: string; bold?: true; italic?: true };

type Mark = "bold" | "italic";
type Delimiter = { kind: "marks"; count: number; canOpen: boolean; canClose: boolean; opens: Mark[]; closes: Mark[] };
type Token = { kind: "text"; text: string } | Delimiter;

const SPACE = /\s/u;
const OPENING = /[\s\p{Ps}\p{Pi}"'/]/u;
const PUNCTUATION = /[\s\p{P}\p{S}]/u;
const WIDTH: Record<Mark, number> = { bold: 2, italic: 1 };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const text = (value: string) => {
    const last = tokens.at(-1);
    if (last?.kind === "text") last.text += value;
    else tokens.push({ kind: "text", text: value });
  };
  for (let index = 0; index < source.length; ) {
    if (source.startsWith("\\*", index)) {
      text("*");
      index += 2;
      continue;
    }
    if (source[index] !== "*") {
      text(source[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (source[end] === "*") end += 1;
    const before = source[index - 1];
    const after = source[end];
    tokens.push({
      kind: "marks",
      count: end - index,
      canOpen: (before === undefined || OPENING.test(before)) && after !== undefined && !SPACE.test(after),
      canClose: before !== undefined && !SPACE.test(before) && (after === undefined || PUNCTUATION.test(after)),
      opens: [],
      closes: [],
    });
    index = end;
  }
  return tokens;
}

/** The citation as runs of plain, bold and italic text. */
export function citationSpans(source: string): CitationSpan[] {
  const tokens = tokenize(source);
  const open: Partial<Record<Mark, Delimiter>> = {};
  const left = new Map<Delimiter, number>();

  for (const token of tokens) {
    if (token.kind !== "marks") continue;
    let count = token.count;
    if (token.canClose) {
      for (const mark of ["bold", "italic"] as const) {
        const opener = open[mark];
        if (opener && count >= WIDTH[mark]) {
          token.closes.push(mark);
          count -= WIDTH[mark];
          delete open[mark];
        }
      }
    }
    if (token.canOpen) {
      for (const mark of ["bold", "italic"] as const) {
        if (!open[mark] && count >= WIDTH[mark]) {
          token.opens.push(mark);
          open[mark] = token;
          count -= WIDTH[mark];
        }
      }
    }
    left.set(token, count);
  }
  // A mark that never closed is just asterisks.
  for (const [mark, opener] of Object.entries(open) as [Mark, Delimiter][]) {
    opener.opens = opener.opens.filter((opened) => opened !== mark);
    left.set(opener, (left.get(opener) ?? 0) + WIDTH[mark]);
  }

  const spans: CitationSpan[] = [];
  const style: Partial<Record<Mark, true>> = {};
  const add = (text: string) => {
    if (!text) return;
    const last = spans.at(-1);
    if (last && last.bold === style.bold && last.italic === style.italic) last.text += text;
    else spans.push({ text, ...style });
  };
  for (const token of tokens) {
    if (token.kind === "text") {
      add(token.text);
      continue;
    }
    for (const mark of token.closes) delete style[mark];
    add("*".repeat(left.get(token) ?? 0));
    for (const mark of token.opens) style[mark] = true;
  }
  return spans;
}

/** The citation without its marks: for the AI, the fact guard and a plain-text copy. */
export function citationText(source: string): string {
  return citationSpans(source)
    .map((span) => span.text)
    .join("")
    .trim();
}

/** Asterisks escaped, so text read from elsewhere (an imported resume) shows as it was. */
export const escapeMarks = (text: string) => text.replace(/\*/g, "\\*");

/** "Rossi, S. H., Dombrowe, V., Godfrey, L.…": a citation's start, as a label for it. */
export function citationExcerpt(source: string, length = 40): string {
  const text = citationText(source).replace(/\s+/g, " ");
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}

/** A publication's part of a tailored resume: "Publication “Doe, J., & Vermeer, K. (2016). Trust…”". */
export const publicationLabel = (citation: string) => `Publication “${citationExcerpt(citation) || "Untitled"}”`;

const WORD = /[\p{L}\p{N}]/u;

/**
 * B and I in the citation's editor: wraps the selection in the mark, or takes
 * the mark off when it's already around it. A selection inside a word grows
 * to the whole word, since marks only count at a word's edge; with nothing
 * selected, the marks go in with the cursor between them.
 */
export function toggleMark(
  text: string,
  selection: { start: number; end: number },
  mark: Mark,
): { text: string; start: number; end: number } {
  const marks = "*".repeat(WIDTH[mark]);
  let { start, end } = selection;
  // The marks hug the text, not the spaces around it.
  while (start < end && SPACE.test(text[start])) start += 1;
  while (end > start && SPACE.test(text[end - 1])) end -= 1;

  if (start === end) {
    return { text: text.slice(0, start) + marks + marks + text.slice(start), start: start + marks.length, end: start + marks.length };
  }
  while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start])) start -= 1;
  while (end < text.length && WORD.test(text[end]) && WORD.test(text[end - 1])) end += 1;

  // How many asterisks run from `from`, backwards or forwards.
  const run = (from: number, step: -1 | 1) => {
    let count = 0;
    for (let index = step < 0 ? from - 1 : from; text[index] === "*"; index += step) count += 1;
    return count;
  };
  // Bold is two of a run of two or three; italic is the odd one out of one or three.
  const marked = (before: number, after: number) =>
    mark === "bold" ? before >= 2 && after >= 2 : before % 2 === 1 && after % 2 === 1;

  // Already marked just outside the selection: take the marks off.
  if (marked(run(start, -1), run(end, 1))) {
    const unwrapped = text.slice(0, start - marks.length) + text.slice(start, end) + text.slice(end + marks.length);
    return { text: unwrapped, start: start - marks.length, end: end - marks.length };
  }
  // Or the selection takes in its marks, and it's all marked that way.
  const inside = text.slice(start, end);
  const spans = citationSpans(inside);
  if (spans.length === 1 && spans[0][mark] && marked(run(start, 1), run(end, -1))) {
    const unwrapped = text.slice(0, start) + inside.slice(marks.length, -marks.length) + text.slice(end);
    return { text: unwrapped, start, end: end - marks.length * 2 };
  }
  const wrapped = text.slice(0, start) + marks + inside + marks + text.slice(end);
  return { text: wrapped, start: start + marks.length, end: end + marks.length };
}

/** A bare DOI ("10.1038/…" or "doi:10.1038/…") as its link; anything else as it was typed. */
export function publicationLink(link: string): string {
  const trimmed = link.trim();
  const doi = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(trimmed);
  return doi ? `https://doi.org/${doi[1]}` : trimmed;
}

/** The link a resume can open: http(s) only, with "https://" added when it's missing. */
export function publicationHref(link: string): string | null {
  const value = publicationLink(link);
  if (!value) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
