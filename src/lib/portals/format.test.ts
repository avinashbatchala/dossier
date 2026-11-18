import { describe, expect, it } from "vitest";

import { parsePortalConfig, portalConfigSchema } from "./format";
import { boardsSample, feedSample, jobPostingSample, jsonSample } from "./samples.test-data";

const problems = (config: unknown) => {
  const parsed = parsePortalConfig(config);
  return parsed.ok ? [] : parsed.problems;
};

describe("portal configs", () => {
  it("reads one of each kind, with the defaults filled in", () => {
    for (const sample of [jsonSample, feedSample, jobPostingSample]) expect(problems(sample)).toEqual([]);
    const config = portalConfigSchema.parse(feedSample);
    expect(config).toMatchObject({ fields: [], quota: null, consent: null, timeoutSeconds: 120, minGapSeconds: 0, maps: {}, keyUrl: null });
    expect(config.search).toMatchObject({ headers: {}, params: [], paging: { type: "none" }, itemsMayBeMissing: false });
  });

  it("refuses a field it doesn't know, saying where", () => {
    expect(problems({ ...jsonSample, script: "alert(1)" })).toEqual([expect.stringContaining("script")]);
    expect(problems({ ...jsonSample, search: { ...jsonSample.search, onAnswer: "x" } })).toEqual([expect.stringMatching(/^search: .*onAnswer/)]);
    expect(problems({ ...jsonSample, search: { ...jsonSample.search, posting: { ...jsonSample.search.posting, title: { path: "title", eval: "1" } } } })).not.toEqual([]);
  });

  it("only lets it reach public hosts it lists", () => {
    const hosts = (extra: string) => ({ ...jsonSample, hosts: ["api.sample.example", extra] });
    expect(problems(hosts("192.168.1.10"))).toEqual([expect.stringMatching(/^hosts\.1: .*not an IP address/)]);
    expect(problems(hosts("intranet.local"))).toEqual([expect.stringContaining("public internet")]);
    expect(problems(hosts("localhost"))).not.toEqual([]);
    expect(problems({ ...jsonSample, base: "https://elsewhere.example/v2" })).toEqual(["hosts: elsewhere.example isn't in hosts."]);
    expect(problems({ ...jsonSample, base: "http://api.sample.example/v2" })).toEqual([expect.stringContaining("https://")]);
  });

  it("checks the names and filters its templates and conditions use", () => {
    const search = (change: object) => ({ ...jsonSample, search: { ...jsonSample.search, ...change } });
    expect(problems(search({ url: "{base}/{counrty}/jobs" }))).toEqual(["search.url: {counrty} isn't a name a template can use."]);
    expect(problems(search({ headers: { Authorization: "Bearer {fields.token}" } }))).toEqual(["search.headers.Authorization: {fields.token} isn't a name a template can use."]);
    expect(problems(search({ params: [{ name: "d", value: "{postedWithin|map:missing}" }] }))).toEqual(["search.params.0.value: |map:missing names no table in maps."]);
    expect(problems(search({ params: [{ name: "d", value: "{keywords|eval}" }] }))).toEqual(["search.params.0.value: |eval isn't a filter."]);
    expect(problems(search({ params: [{ name: "d", value: "x", when: "salary" }] }))).toEqual([expect.stringContaining("reads salary")]);
    expect(problems(search({ url: "{base}/jobs}" }))).toEqual([expect.stringContaining("isn't a placeholder")]);
  });

  it("asks for where the postings are, except on a JobPosting page", () => {
    expect(problems({ ...jsonSample, search: { ...jsonSample.search, items: undefined } })).toEqual(["search.items: Say where the list of postings is."]);
    expect(problems(jobPostingSample)).toEqual([]);
  });

  it("asks for each entry of a list field only, without pages, and lets its templates read {each}", () => {
    expect(problems(boardsSample)).toEqual([]);
    expect(portalConfigSchema.parse(boardsSample)).toMatchObject({ maxMegabytes: 20, fields: [{ type: "list", required: true, max: 3 }], search: { keepMinutes: 30, each: { field: "boards", atOnce: 2 } } });
    expect(problems({ ...boardsSample, search: { ...boardsSample.search, each: { field: "missing" } } })).toEqual(["search.each.field: missing isn't a list field."]);
    expect(problems({ ...boardsSample, search: { ...boardsSample.search, paging: { type: "offset", size: 20 } } })).toEqual(["search.paging: A search for each entry has no pages."]);
    expect(problems({ ...boardsSample, search: { ...boardsSample.search, each: undefined } })).toEqual([
      "search.url: {each} isn't a name a template can use.",
      "search.posting.company.template: {each} isn't a name a template can use.",
    ]);
    expect(problems({ ...boardsSample, maxMegabytes: 100 })).toEqual([expect.stringMatching(/^maxMegabytes: /)]);
  });

  it("keeps ids to the shape rows store", () => {
    expect(problems({ ...jsonSample, id: "sample" })).toEqual([expect.stringMatching(/^id: /)]);
  });
});
