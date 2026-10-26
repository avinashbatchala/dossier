import { describe, expect, it } from "vitest";

import { citationExcerpt, citationSpans, citationText, escapeMarks, publicationHref, publicationLink, toggleMark } from "./citation";

const ROSSI =
  "Rossi, S. H., **Dombrowe, V.**, Godfrey, L. (2025). Evidence of DNA methylation heterogeneity. *Oncogene*, 44(15), 1024-1036.";

describe("citation marks (#218)", () => {
  it("reads **bold** and *italic*", () => {
    expect(citationSpans(ROSSI)).toEqual([
      { text: "Rossi, S. H., " },
      { text: "Dombrowe, V.", bold: true },
      { text: ", Godfrey, L. (2025). Evidence of DNA methylation heterogeneity. " },
      { text: "Oncogene", italic: true },
      { text: ", 44(15), 1024-1036." },
    ]);
  });

  it("reads both at once, and one inside the other", () => {
    expect(citationSpans("***Both***")).toEqual([{ text: "Both", bold: true, italic: true }]);
    expect(citationSpans("**Bold *and italic***")).toEqual([
      { text: "Bold ", bold: true },
      { text: "and italic", bold: true, italic: true },
    ]);
    expect(citationSpans("*J. Biol. Chem.* 12")).toEqual([{ text: "J. Biol. Chem.", italic: true }, { text: " 12" }]);
  });

  it("keeps asterisks that aren't at a word's edge, like equal contribution", () => {
    const equal = "Rossi, S. H.*, Dombrowe, V.*, Godfrey, L.";
    expect(citationSpans(equal)).toEqual([{ text: equal }]);
    expect(citationSpans("*Equal contribution")).toEqual([{ text: "*Equal contribution" }]);
    expect(citationSpans("p < 0.05 * 2 and 3 * 4")).toEqual([{ text: "p < 0.05 * 2 and 3 * 4" }]);
    expect(citationSpans("**Unclosed and *one*")).toEqual([{ text: "**Unclosed and " }, { text: "one", italic: true }]);
  });

  it("reads \\* as an asterisk", () => {
    expect(citationSpans("\\*Smith\\*")).toEqual([{ text: "*Smith*" }]);
    expect(citationText(escapeMarks("*Not italic*"))).toBe("*Not italic*");
  });

  it("gives the text without marks", () => {
    expect(citationText(ROSSI)).toBe(
      "Rossi, S. H., Dombrowe, V., Godfrey, L. (2025). Evidence of DNA methylation heterogeneity. Oncogene, 44(15), 1024-1036.",
    );
  });

  it("starts a label with the citation's first words", () => {
    expect(citationExcerpt(ROSSI)).toBe("Rossi, S. H., Dombrowe, V., Godfrey, L…");
    expect(citationExcerpt("Short one.")).toBe("Short one.");
  });
});

describe("B and I (#218)", () => {
  const select = (text: string, part: string) => ({ start: text.indexOf(part), end: text.indexOf(part) + part.length });

  it("wraps the selection, without the spaces around it", () => {
    const text = "Rossi, S. H., Dombrowe, V., Godfrey";
    expect(toggleMark(text, select(text, " Dombrowe, V."), "bold")).toEqual({
      text: "Rossi, S. H., **Dombrowe, V.**, Godfrey",
      start: 16,
      end: 28,
    });
    expect(toggleMark("in Oncogene, 44", select("in Oncogene, 44", "Oncogene"), "italic").text).toBe("in *Oncogene*, 44");
  });

  it("grows a selection inside a word to the whole word", () => {
    expect(toggleMark("in Oncogene, 44", select("in Oncogene, 44", "cog"), "italic").text).toBe("in *Oncogene*, 44");
  });

  it("takes the marks off when they're already there", () => {
    const text = "Rossi, **Dombrowe, V.**, Godfrey";
    expect(toggleMark(text, select(text, "Dombrowe, V."), "bold").text).toBe("Rossi, Dombrowe, V., Godfrey");
    expect(toggleMark(text, select(text, "**Dombrowe, V.**"), "bold").text).toBe("Rossi, Dombrowe, V., Godfrey");
    expect(toggleMark("a ***b*** c", select("a ***b*** c", "b"), "italic").text).toBe("a **b** c");
    expect(toggleMark("a ***b*** c", select("a ***b*** c", "b"), "bold").text).toBe("a *b* c");
  });

  it("adds italic to bold rather than taking bold off", () => {
    expect(toggleMark("a **b** c", select("a **b** c", "b"), "italic").text).toBe("a ***b*** c");
  });

  it("puts the cursor between new marks when nothing is selected", () => {
    expect(toggleMark("ab ", { start: 3, end: 3 }, "bold")).toEqual({ text: "ab ****", start: 5, end: 5 });
  });
});

describe("publication links (#218)", () => {
  it("turns a bare DOI into its link", () => {
    expect(publicationLink(" 10.1038/s41388-024-03270-3 ")).toBe("https://doi.org/10.1038/s41388-024-03270-3");
    expect(publicationLink("doi:10.1038/s41388-024-03270-3")).toBe("https://doi.org/10.1038/s41388-024-03270-3");
    expect(publicationLink("https://doi.org/10.1038/x")).toBe("https://doi.org/10.1038/x");
  });

  it("opens web links only", () => {
    expect(publicationHref("doi.org/10.1038/x")).toBe("https://doi.org/10.1038/x");
    expect(publicationHref("10.1038/x")).toBe("https://doi.org/10.1038/x");
    expect(publicationHref("javascript:alert(1)")).toBeNull();
    expect(publicationHref("")).toBeNull();
  });
});
