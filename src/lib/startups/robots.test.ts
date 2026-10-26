import { afterEach, describe, expect, it, vi } from "vitest";

import { clearRobotsCache, robotsAllowed } from "./robots";

const site = vi.hoisted(() => ({ answer: { ok: false, error: "x" } as { ok: true; html: string; url: string } | { ok: false; error: string; status?: number }, asked: 0 }));
vi.mock("./http", () => ({
  ROBOTS_TOKEN: "dossier",
  getSitePage: async () => {
    site.asked += 1;
    return site.answer;
  },
}));

afterEach(() => {
  clearRobotsCache();
  site.asked = 0;
});

describe("following a startup's robots.txt (#222)", () => {
  it("follows its rules for Dossier, and asks once a day", async () => {
    site.answer = { ok: true, html: "User-agent: Dossier\nDisallow: /team", url: "https://acme.com/robots.txt" };
    expect(await robotsAllowed("https://acme.com/team")).toBe(false);
    expect(await robotsAllowed("https://acme.com/careers?x=1")).toBe(true);
    expect(site.asked).toBe(1);
  });

  it("allows everything when there's no file, and nothing when the site refuses or fails", async () => {
    site.answer = { ok: false, error: "missing", status: 404 };
    expect(await robotsAllowed("https://a.com/careers")).toBe(true);
    for (const status of [401, 403, 429, 500]) {
      clearRobotsCache();
      site.answer = { ok: false, error: "no", status };
      expect(await robotsAllowed("https://a.com/careers")).toBe(false);
    }
    clearRobotsCache();
    site.answer = { ok: false, error: "unreachable" };
    expect(await robotsAllowed("https://a.com/careers")).toBe(false);
  });
});
