// Where each requirement stands in the posting (E31-3, design 6b): the
// scoring engine's requirements are the posting's own lines (postingLines in
// src/lib/scoring/posting-lines.ts), with emphasis marks dropped and spaces
// and wrapped lines joined, so each is found again in the posting as pasted.
// A requirement worded otherwise, as in readings from before, isn't marked.

/** A requirement found in the posting: its place in the text, and its row in How you fit. */
export type PostingHighlight = { start: number; end: number; index: number };

const INVISIBLE = /[​-‍⁠﻿­]/u;

/** The text as postingLines reads it, and where in the original each of its characters is. */
function normalized(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if ((char === "*" || char === "_") && text[at + 1] === char) {
      at++;
      continue;
    }
    if (INVISIBLE.test(char)) continue;
    if (/\s/u.test(char)) {
      if (out.length > 0 && !out.endsWith(" ")) {
        out += " ";
        from.push(at);
      }
      continue;
    }
    out += char;
    from.push(at);
  }
  return { text: out, from };
}

/** Each requirement's first place in the posting that no other one has taken, in the posting's order. */
export function postingHighlights(posting: string, requirements: readonly string[]): PostingHighlight[] {
  const { text, from } = normalized(posting);
  const lower = text.toLowerCase();
  const found: PostingHighlight[] = [];
  requirements.forEach((requirement, index) => {
    // A line cut short ends in an ellipsis the posting doesn't have.
    const wanted = requirement.replace(/\s+/g, " ").trim().replace(/\s*…$/u, "").toLowerCase();
    if (wanted.length < 3) return;
    for (let at = lower.indexOf(wanted); at >= 0; at = lower.indexOf(wanted, at + 1)) {
      const start = from[at];
      let end = from[at + wanted.length - 1] + 1;
      // Its closing emphasis too, so the marks pair up.
      while (/^(\*\*|__)/.test(posting.slice(end, end + 2))) end += 2;
      if (found.some((other) => start < other.end && other.start < end)) continue;
      found.push({ start, end, index });
      return;
    }
  });
  return found.toSorted((a, b) => a.start - b.start);
}
