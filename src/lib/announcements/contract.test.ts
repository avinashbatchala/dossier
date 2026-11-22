import { describe, expect, it } from "vitest";

import schemaCopy from "./api-v1.schema.json";
import { announcementSchema, parseAnnouncements, SEVERITIES } from "./contract";

const notice = {
  id: "ann_01",
  severity: "security",
  title: "Update to 1.13.1",
  body: "This release fixes a security problem in sign-in.",
  link: { label: "What's new", url: "https://github.com/AienTech/dossier/releases/tag/v1.13.1" },
  minVersion: null,
  maxVersion: "1.13.0",
  publishedAt: "2026-11-10T09:00:00Z",
  expiresAt: null,
};

const one = (changes: Record<string, unknown>) => parseAnnouncements({ announcements: [{ ...notice, ...changes }] });

describe("parseAnnouncements (E18-1)", () => {
  it("reads the contract's example", () => {
    expect(parseAnnouncements({ announcements: [notice] })).toEqual([notice]);
    expect(parseAnnouncements({ announcements: [] })).toEqual([]);
  });

  it("ignores fields it doesn't know, at every level", () => {
    const [read] = parseAnnouncements({
      news: true,
      announcements: [{ ...notice, audience: "desktop", link: { ...notice.link, target: "new" } }],
    })!;
    expect(read).toEqual(notice);
  });

  it("counts a severity it doesn't know as info", () => {
    expect(one({ severity: "urgent" })![0].severity).toBe("info");
    expect(one({ severity: "important" })![0].severity).toBe("important");
  });

  it("reads absent and null optional values the same", () => {
    const { link, minVersion, maxVersion, expiresAt, ...required } = notice;
    void [link, minVersion, maxVersion, expiresAt];
    expect(parseAnnouncements({ announcements: [required] })).toEqual([{ ...required, link: null, minVersion: null, maxVersion: null, expiresAt: null }]);
  });

  it("keeps a line break in the text", () => {
    expect(one({ body: "One.\nTwo." })![0].body).toBe("One.\nTwo.");
  });

  it("skips an item it can't read and keeps the others", () => {
    const bad = [
      { id: undefined },
      { id: "" },
      { title: "" },
      { title: "x".repeat(81) },
      { body: "x".repeat(501) },
      { minVersion: "soon" },
      { maxVersion: "1.13" },
      { publishedAt: "yesterday" },
      { expiresAt: "tomorrow" },
      { severity: 3 },
    ];
    for (const changes of bad) {
      expect(parseAnnouncements({ announcements: [{ ...notice, ...changes }, { ...notice, id: "ann_02" }] })?.map(({ id }) => id)).toEqual(["ann_02"]);
    }
    expect(parseAnnouncements({ announcements: ["text", null, 3] })).toEqual([]);
  });

  it("takes the longest text the contract allows", () => {
    expect(one({ title: "x".repeat(80), body: "x".repeat(500) })).toHaveLength(1);
  });

  it("keeps a notice whose link it can't read, without the link", () => {
    expect(one({ link: { label: "No address" } })![0].link).toBeNull();
    expect(one({ link: "https://dossier.aien.me" })![0].link).toBeNull();
  });

  it("gives up on an answer that isn't the expected shape", () => {
    for (const answer of [null, undefined, "text", [], {}, { announcements: {} }, { announcements: "none" }]) {
      expect(parseAnnouncements(answer)).toBeNull();
    }
  });

  it("keeps a limited number, so an answer can't fill the database", () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ ...notice, id: `ann_${index}` }));
    const read = parseAnnouncements({ announcements: many })!;
    expect(read).toHaveLength(50);
    expect(read[0].id).toBe("ann_0");
  });
});

describe("the copy of the contract's JSON Schema", () => {
  const item = schemaCopy.announcements.properties.announcements.items;

  it("names the fields the app reads, and no others", () => {
    expect(Object.keys(announcementSchema.shape).sort()).toEqual(Object.keys(item.properties).sort());
  });

  it("has the same severities and limits", () => {
    expect([...item.properties.severity.enum].sort()).toEqual([...SEVERITIES].sort());
    expect(one({ title: "x".repeat(item.properties.title.maxLength) })).toHaveLength(1);
    expect(one({ title: "x".repeat(item.properties.title.maxLength + 1) })).toHaveLength(0);
    expect(one({ body: "x".repeat(item.properties.body.maxLength) })).toHaveLength(1);
    expect(one({ body: "x".repeat(item.properties.body.maxLength + 1) })).toHaveLength(0);
  });
});
