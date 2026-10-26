import { afterEach, describe, expect, it, vi } from "vitest";

import { addressesOnPage, lookUpSite, rankEmails } from "./emails";
import type { StartupEmail } from "./types";

const site = vi.hoisted(() => ({ pages: {} as Record<string, { ok: true; html: string; url: string } | { ok: false; error: string; status?: number }>, disallowed: [] as string[], asked: [] as string[] }));
vi.mock("./http", () => ({
  getSitePage: async (url: string) => {
    site.asked.push(url);
    return site.pages[url] ?? { ok: false, error: "missing", status: 404 };
  },
}));
vi.mock("./robots", () => ({ robotsAllowed: async (url: string) => !site.disallowed.includes(url) }));

afterEach(() => {
  site.pages = {};
  site.disallowed = [];
  site.asked = [];
});

const now = new Date("2026-10-23T12:00:00Z");
const page = (url: string, html: string) => ({ ok: true as const, html, url });

describe("a startup's published addresses (#222)", () => {
  it("reads role addresses on the startup's own domain, and people's only when asked", () => {
    const html = '<a href="mailto:jobs@acme.com?subject=Hi">Apply</a><p>Founders: founders@acme.com. Jane: jane@acme.com. Partner: x@other.com</p>';
    expect(addressesOnPage(html, "https://acme.com/careers", "acme.com", { people: false, now }).map((entry) => entry.email)).toEqual(["jobs@acme.com", "founders@acme.com"]);
    expect(addressesOnPage(html, "https://acme.com/careers", "acme.com", { people: true, now })).toContainEqual({
      email: "jane@acme.com",
      label: "Person",
      from: "https://acme.com/careers",
      onRequest: true,
      foundAt: now.toISOString(),
    });
    expect(addressesOnPage('<a href="mailto:%E0%A4%A">x</a>', "https://acme.com", "acme.com", { people: true, now })).toEqual([]);
  });

  it("puts application addresses first, once each", () => {
    const entry = (email: string, label: StartupEmail["label"]): StartupEmail => ({ email, label, from: "", onRequest: false, foundAt: "" });
    expect(rankEmails([entry("hi@a.com", "General"), entry("jane@a.com", "Person"), entry("jobs@a.com", "Hiring"), entry("hi@a.com", "General")]).map((e) => e.email)).toEqual([
      "jobs@a.com",
      "hi@a.com",
      "jane@a.com",
    ]);
  });

  it("reads the home, careers, jobs and contact pages, one at a time, as robots.txt allows", async () => {
    site.pages = {
      "https://acme.com/": page("https://acme.com/", "<p>hello@acme.com</p>"),
      "https://acme.com/careers": page("https://acme.com/careers", "<p>careers@acme.com and jane@acme.com</p>"),
      "https://acme.com/contact": page("https://other.com/contact", "<p>info@acme.com</p>"),
    };
    site.disallowed = ["https://acme.com/jobs"];
    const found = await lookUpSite("https://acme.com/about-us", { now });
    expect(site.asked).toEqual(["https://acme.com/", "https://acme.com/careers", "https://acme.com/contact"]);
    expect(found).toEqual({
      emails: [
        { email: "careers@acme.com", label: "Hiring", from: "https://acme.com/careers", onRequest: false, foundAt: now.toISOString() },
        { email: "hello@acme.com", label: "General", from: "https://acme.com/", onRequest: false, foundAt: now.toISOString() },
      ],
      noApplicationsFrom: "",
      refused: false,
    });
  });

  it("also reads the about and team pages for people's addresses when asked", async () => {
    site.pages = { "https://acme.com/team": page("https://www.acme.com/team", "<p>Jane, jane@acme.com</p>") };
    const found = await lookUpSite("https://acme.com", { people: true, now });
    expect(site.asked).toHaveLength(6);
    expect(found.emails.map((entry) => entry.email)).toEqual(["jane@acme.com"]);
  });

  it("stops at a site that refuses, and notes one that takes no unsolicited applications", async () => {
    site.pages = { "https://acme.com/": { ok: false, error: "no", status: 429 } };
    expect(await lookUpSite("https://acme.com")).toEqual({ emails: [], noApplicationsFrom: "", refused: true });
    expect(site.asked).toEqual(["https://acme.com/"]);

    site.asked = [];
    site.pages = { "https://acme.com/careers": page("https://acme.com/careers", "<p>jobs@acme.com</p><p>We do not accept unsolicited applications.</p>") };
    expect(await lookUpSite("https://acme.com")).toMatchObject({ noApplicationsFrom: "“We do not accept unsolicited applications.” (acme.com/careers)" });
    expect(await lookUpSite("not a site")).toEqual({ emails: [], noApplicationsFrom: "", refused: false });
  });
});
