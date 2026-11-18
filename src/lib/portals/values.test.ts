import { describe, expect, it } from "vitest";

import { allHold, fill, holds } from "./template";
import { at, read } from "./values";
import { decodeEntities, parseXml } from "./xml";

const context = { tables: { posted: { week: "7" } }, values: { keywords: "UX designer", place: "Hamburg", country: "de", id: "a/b" } };

describe("templates", () => {
  it("fills names and filters, and encodes values in an address but not {base}", () => {
    expect(fill("{keywords} in {place}", context.values, context.tables)).toBe("UX designer in Hamburg");
    expect(fill("{country|upper}-{missing|default:us}-{keywords|lower}", context.values, context.tables)).toBe("DE-us-ux designer");
    expect(fill("{base}/jobs/{id}/{keywords}", { ...context.values, base: "https://x.example/a b" }, {}, { inUrl: true })).toBe("https://x.example/a b/jobs/a%2Fb/UX%20designer");
    expect(fill("{id|base64|raw}", { id: "10000-1234" }, {}, { inUrl: true })).toBe("MTAwMDAtMTIzNA==");
    expect(fill("{week|map:posted}", { week: "week" }, context.tables)).toBe("7");
  });

  it("decides when a parameter is sent", () => {
    const values = { place: "Hamburg", remoteOnly: "", level: "senior" };
    expect([holds("place", values), holds("!place", values), holds("remoteOnly", values), holds("!remoteOnly", values)]).toEqual([true, false, false, true]);
    expect([holds("level=senior|lead", values), holds("level!=senior|lead", values), holds("level=intern", values)]).toEqual([true, false, false]);
    expect(allHold(["place", "level=senior"], values)).toBe(true);
    expect(allHold(undefined, values)).toBe(true);
  });
});

describe("values", () => {
  const item = {
    title: "  Designer  ",
    tags: [{ name: "Remote" }, { name: "UX" }, { name: "Remote" }],
    options: [
      { direct: false, link: "https://board.example/1" },
      { direct: true, link: "javascript:alert(1)" },
      { direct: true, link: "https://employer.example/apply" },
    ],
    where: "Hamburg  •  via Stepstone",
    html: "<p>Hello <strong>you</strong> &amp; more</p>",
    home: 100,
    posted: 1_700_000_000,
    day: "2026-11-14T12:00:00",
  };

  it("reads paths, and only an item's own properties", () => {
    expect(read(item, "title", context)).toBe("  Designer  ");
    expect(read(item, "tags.1.name", context)).toBe("UX");
    expect(at({}, "__proto__")).toBeUndefined();
    expect(at({}, "constructor")).toBeUndefined();
    expect(read(item, "tags", context)).toBeNull();
  });

  it("picks, joins, lists and finds", () => {
    expect(read(item, { first: ["missing", "title"] }, context)).toBe("  Designer  ");
    expect(read(item, { each: "tags", take: "name", unique: true, with: " / " }, context)).toBe("Remote / UX");
    expect(read(item, { find: "options", where: { direct: true }, take: "link", link: true }, context)).toBe("https://employer.example/apply");
    expect(read(item, { join: [{ value: "a" }, "missing", { value: "b" }], with: ", " }, context)).toBe("a, b");
    expect(read(item, { template: "https://board.example/{id|url}" }, context)).toBe("https://board.example/a%2Fb");
  });

  it("shapes what it reads", () => {
    expect(read(item, { path: "where", split: "•", squash: true }, context)).toBe("Hamburg");
    expect(read(item, { path: "html", clean: "html" }, context)).toBe("Hello you & more");
    expect(read(item, { path: "home", atLeast: 100, then: true }, context)).toBe(true);
    expect(read({ home: 40 }, { path: "home", atLeast: 100, then: true }, context)).toBeNull();
    expect(read({ mode: "remote" }, { path: "mode", map: { remote: true, onsite: false } }, context)).toBe(true);
    expect(read({ mode: "hybrid" }, { path: "mode", map: { remote: true, onsite: false } }, context)).toBeNull();
    expect(read(item, { path: "posted", as: "unix" }, context)).toBe("2023-11-14T22:13:20.000Z");
    expect(read({ created: 1_700_000_000_000 }, { path: "created", as: "unixMs" }, context)).toBe("2023-11-14T22:13:20.000Z");
    expect(read({ where: "Remote - US" }, { path: "where", contains: "remote", then: true }, context)).toBe(true);
    expect(read({ where: "Berlin" }, { path: "where", contains: "remote", then: true }, context)).toBeNull();
    expect(read({ html: "<p>One &amp; two</p><ul><li>Three</li></ul>" }, { path: "html", clean: "htmlText" }, context)).toBe("One & two\nThree");
    expect(read({ html: "&lt;p&gt;Escaped&lt;/p&gt;&lt;p&gt;Twice&lt;/p&gt;" }, { path: "html", clean: "htmlText" }, context)).toBe("Escaped\nTwice");
    expect(read(item, { path: "day", as: "date" }, context)).toBe("2026-11-14T00:00:00.000Z");
    expect(read({ code: "DE" }, { path: "code", as: "countryName" }, context)).toBe("Germany");
    expect(read({ flag: "1" }, { path: "flag", in: ["1", 1, true] }, context)).toBe(true);
  });
});

describe("feeds", () => {
  it("reads RSS with CDATA, entities and repeated items", () => {
    const feed = parseXml(`<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Jobs</title>
        <item><title>Designer &amp; Researcher</title><link>https://jobs.example/1</link><description><![CDATA[<p>Remote <b>UX</b></p>]]></description></item>
        <item><title>Engineer</title><link>https://jobs.example/2</link></item>
      </channel></rss>`);
    expect(at(feed, "rss.@version")).toBe("2.0");
    expect(at(feed, "rss.channel.item.0.title")).toBe("Designer & Researcher");
    expect(at(feed, "rss.channel.item.0.description")).toBe("<p>Remote <b>UX</b></p>");
    expect(at(feed, "rss.channel.item.1.link")).toBe("https://jobs.example/2");
  });

  it("reads Atom's attributes, and an element with both attributes and text", () => {
    const feed = parseXml(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:1</id><link href="https://jobs.example/1"/><title type="text">Designer</title></entry></feed>`);
    expect(at(feed, "feed.entry.link.@href")).toBe("https://jobs.example/1");
    expect(read(feed, "feed.entry.title", context)).toBe("Designer");
  });

  it("never expands a DOCTYPE's entities", () => {
    const feed = parseXml(`<!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>`);
    expect(at(feed, "rss.channel.item.title")).toBe("&b;");
    expect(decodeEntities("&#x263A; &#9731; &lt;b&gt; &nbsp;")).toBe("☺ ☃ <b> &nbsp;");
  });

  it("isn't thrown by broken markup, and finds nothing in text", () => {
    expect(at(parseXml("<rss><channel><item><title>A</item></channel></rss>"), "rss.channel.item.title")).toBe("A");
    expect(parseXml("not xml at all")).toBeNull();
  });
});
