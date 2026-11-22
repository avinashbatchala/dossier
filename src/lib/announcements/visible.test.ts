import { describe, expect, it } from "vitest";

import type { Announcement, AnnouncementFeed } from "./contract";
import { applies, currentAnnouncement, withDismissed } from "./visible";

const now = new Date("2026-11-05T12:00:00Z");

const notice = (changes: Partial<Announcement> = {}): Announcement => ({
  id: "ann_1",
  severity: "info",
  title: "A notice",
  body: "Its text.",
  link: null,
  minVersion: null,
  maxVersion: null,
  publishedAt: "2026-11-01T09:00:00Z",
  expiresAt: null,
  ...changes,
});

const feed = (...items: Announcement[]): AnnouncementFeed => ({ items, etag: null, appVersion: "1.13.0", nextCheckAt: "2026-11-05T18:00:00Z" });
const shown = (items: Announcement[], dismissed: string[] = [], current = "1.13.0") =>
  currentAnnouncement({ announcementFeed: feed(...items), announcementsDismissed: dismissed }, now, current);

describe("applies", () => {
  it("takes both version limits as inclusive, each optional", () => {
    const within = (minVersion: string | null, maxVersion: string | null, current: string) => applies(notice({ minVersion, maxVersion }), now, current);
    expect(within(null, null, "1.13.0")).toBe(true);
    expect(within("1.13.0", null, "1.13.0")).toBe(true);
    expect(within("1.13.1", null, "1.13.0")).toBe(false);
    expect(within(null, "1.13.0", "1.13.0")).toBe(true);
    expect(within(null, "1.12.9", "1.13.0")).toBe(false);
    expect(within("1.10.0", "1.13.0", "1.11.5")).toBe(true);
    expect(within("1.9.0", "1.9.9", "1.10.0")).toBe(false);
  });

  it("stops at the expiry, wherever the list came from", () => {
    expect(applies(notice({ expiresAt: "2026-11-05T12:00:01Z" }), now, "1.13.0")).toBe(true);
    expect(applies(notice({ expiresAt: "2026-11-05T12:00:00Z" }), now, "1.13.0")).toBe(false);
    expect(applies(notice({ expiresAt: "2026-11-01T00:00:00Z" }), now, "1.13.0")).toBe(false);
  });
});

describe("currentAnnouncement", () => {
  it("is nothing before any answer, or with an empty one", () => {
    expect(currentAnnouncement({ announcementFeed: null, announcementsDismissed: [] }, now, "1.13.0")).toBeNull();
    expect(shown([])).toBeNull();
  });

  it("shows the most severe, then the newest", () => {
    const old = notice({ id: "old", publishedAt: "2026-10-01T09:00:00Z" });
    const recent = notice({ id: "recent", publishedAt: "2026-11-02T09:00:00Z" });
    const important = notice({ id: "important", severity: "important", publishedAt: "2026-10-15T09:00:00Z" });
    const security = notice({ id: "security", severity: "security", publishedAt: "2026-09-01T09:00:00Z" });
    expect(shown([old, recent])?.id).toBe("recent");
    expect(shown([old, recent, important])?.id).toBe("important");
    expect(shown([old, recent, important, security])?.id).toBe("security");
  });

  it("shows the next one after a dismiss, and nothing after the last", () => {
    const list = [notice({ id: "a", severity: "security" }), notice({ id: "b" })];
    expect(shown(list, ["a"])?.id).toBe("b");
    expect(shown(list, ["a", "b"])).toBeNull();
  });

  it("passes over a notice that doesn't apply here", () => {
    const list = [notice({ id: "older-versions", severity: "security", maxVersion: "1.12.0" }), notice({ id: "expired", severity: "important", expiresAt: "2026-11-01T00:00:00Z" }), notice({ id: "this" })];
    expect(shown(list)?.id).toBe("this");
    expect(shown(list, [], "1.12.0")?.id).toBe("older-versions");
  });

  it("keeps a link to anywhere on the web", () => {
    for (const url of [
      "https://dossier.aien.me/news",
      "https://github.com/AienTech/dossier/releases/tag/v1.13.1",
      "https://example.org/a?b=c#d",
      "http://example.org/plain",
      "https://example.org:8443/port",
    ]) {
      expect(shown([notice({ link: { label: "More", url } })])?.link, url).toEqual({ label: "More", url });
    }
  });

  it("drops anything else as a link, since it becomes an href, while the notice stays", () => {
    for (const url of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///etc/passwd", "vbscript:x", "mailto:a@example.org", "https://"]) {
      const dropped = shown([notice({ link: { label: "More", url } })]);
      expect(dropped?.title, url).toBe("A notice");
      expect(dropped?.link, url).toBeNull();
    }
  });

  it("doesn't reorder what Settings holds", () => {
    const items = [notice({ id: "a" }), notice({ id: "b", severity: "security" })];
    shown(items);
    expect(items.map(({ id }) => id)).toEqual(["a", "b"]);
  });
});

describe("withDismissed", () => {
  it("adds an ID once", () => {
    expect(withDismissed([], "a")).toEqual(["a"]);
    expect(withDismissed(["a", "b"], "a")).toEqual(["b", "a"]);
  });

  it("keeps the newest 100", () => {
    const many = Array.from({ length: 100 }, (_, index) => `ann_${index}`);
    const kept = withDismissed(many, "new");
    expect(kept).toHaveLength(100);
    expect(kept[0]).toBe("ann_1");
    expect(kept.at(-1)).toBe("new");
  });
});
