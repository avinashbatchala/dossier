import { describe, expect, it } from "vitest";

import { entryOf, listEntries } from "./list-field";

describe("list fields", () => {
  it("takes a name, or the name in a board's link", () => {
    expect(entryOf(" acme ")).toBe("acme");
    expect(entryOf("https://boards.greenhouse.io/airbnb")).toBe("airbnb");
    expect(entryOf("https://job-boards.greenhouse.io/airbnb/jobs/123")).toBe("airbnb");
    expect(entryOf("https://boards.greenhouse.io/embed/job_board?for=airbnb")).toBe("airbnb");
    expect(entryOf("https://jobs.lever.co/palantir")).toBe("palantir");
    expect(entryOf("https://jobs.ashbyhq.com/ramp")).toBe("ramp");
  });

  it("refuses what isn't a name", () => {
    for (const line of ["two words", "a/b", "https://example.com/", "http://", "naïve"]) expect(entryOf(line), line).toBe("");
  });

  it("reads one a line or comma, each once, up to the limit, and keeps what it couldn't read", () => {
    expect(listEntries("acme\n\nglobex, acme\nnot one\ninitech", 2)).toEqual({ entries: ["acme", "globex"], unread: ["not one"] });
  });
});
