import { describe, expect, it } from "vitest";

import type { FoundPosting } from "@/lib/job-search/search";

import { roundRobinPostings } from "./run";

const posting = (id: string, day: number, extra: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH", externalId: id, title: id, company: "Company", place: "Berlin", remote: false,
  salary: "", postedAt: `2026-10-${day}T00:00:00Z`, url: `https://jobs.example/${id}`, via: "", description: "", complete: false, ...extra,
});
const ids = (pages: FoundPosting[][]) => roundRobinPostings(pages).map((posting) => posting.externalId);

describe("round-robin candidate order", () => {
  it("cycles searches in order, newest first within each, without mutating source pages", () => {
    const first = [posting("a-old", 10), posting("a-new", 20), posting("a-mid", 15)];
    const second = [posting("b-old", 11), posting("b-new", 19)];
    expect(ids([first, second])).toEqual(["a-new", "b-new", "a-mid", "b-old", "a-old"]);
    expect(first.map((posting) => posting.externalId)).toEqual(["a-old", "a-new", "a-mid"]);
    expect(second.map((posting) => posting.externalId)).toEqual(["b-old", "b-new"]);
  });

  it("skips overlapping URL identities without spending the second search's turn", () => {
    const shared = posting("shared", 20);
    const alias = posting("alias", 20, { source: "ADZUNA", url: `${shared.url}?utm_source=other` });
    expect(ids([[shared, posting("a", 19)], [alias, posting("b", 18)], [posting("c", 17)]])).toEqual(["shared", "b", "c", "a"]);
  });

  it("also dedupes source/id identities with different URLs and drains unequal or empty searches", () => {
    expect(ids([[], [posting("same", 20), posting("same", 19, { url: "https://other.example/alias" }), posting("b", 18)], [posting("c", 17)]])).toEqual(["same", "c", "b"]);
    expect(ids([[], []])).toEqual([]);
  });
});
