import { describe, expect, it } from "vitest";

import { postingLines } from "@/lib/scoring/posting-lines";

import { postingHighlights } from "./posting-highlights";

const POSTING = `Ledgerly: Senior Product Designer, Payments

What we're looking for
- 5+ years of **product design**
- You've built or maintained a design system,
  ideally one used by several teams
- Experience with Kubernetes`;

const marked = (posting: string, requirements: string[]) => postingHighlights(posting, requirements).map(({ start, end, index }) => [index, posting.slice(start, end)]);

describe("postingHighlights (E31-3)", () => {
  it("finds each of the scoring engine's lines in the posting as pasted, emphasis and wrapping included", () => {
    // The lines the engine kept as requirements.
    const lines = postingLines(POSTING).filter((line) => line.startsWith("5+") || line.startsWith("You've") || line.startsWith("Experience"));
    expect(marked(POSTING, lines)).toEqual([
      [0, "5+ years of **product design**"],
      [1, "You've built or maintained a design system,\n  ideally one used by several teams"],
      [2, "Experience with Kubernetes"],
    ]);
  });

  it("finds a line cut short, and ignores case", () => {
    expect(marked(POSTING, ["experience with kube…"])).toEqual([[0, "Experience with Kube"]]);
  });

  it("leaves out a requirement worded otherwise, and doesn't mark one place twice", () => {
    expect(marked(POSTING, ["Knows payments", "Experience with Kubernetes", "Kubernetes"])).toEqual([[1, "Experience with Kubernetes"]]);
  });
});
