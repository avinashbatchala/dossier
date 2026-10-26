import { describe, expect, it } from "vitest";

import { parseRobots, robotsAllow } from "./robots-rules";

describe("robots.txt rules (RFC 9309, #222)", () => {
  const file = [
    "# Everyone",
    "User-agent: *",
    "Disallow: /private",
    "Allow: /private/careers",
    "",
    "User-agent: OtherBot",
    "User-agent: Dossier",
    "Disallow: /team",
    "Disallow: /*.pdf$",
    "Disallow:",
    "Sitemap: https://acme.com/sitemap.xml",
  ].join("\n");

  it("uses the groups naming Dossier, else the ones for everyone", () => {
    const own = parseRobots(file, "dossier");
    expect(robotsAllow(own, "/team")).toBe(false);
    expect(robotsAllow(own, "/private")).toBe(true);
    const others = parseRobots(file, "somebot");
    expect(robotsAllow(others, "/private/x")).toBe(false);
    expect(robotsAllow(others, "/team")).toBe(true);
  });

  it("lets the longest rule win, and Allow on a tie", () => {
    const rules = parseRobots(file, "anybot");
    expect(robotsAllow(rules, "/private/careers/jobs")).toBe(true);
    expect(robotsAllow(parseRobots("User-agent: *\nDisallow: /a\nAllow: /a", "x"), "/a")).toBe(true);
  });

  it("reads * and $ in paths", () => {
    const rules = parseRobots(file, "dossier");
    expect(robotsAllow(rules, "/files/deck.pdf")).toBe(false);
    expect(robotsAllow(rules, "/files/deck.pdf?x=1")).toBe(true);
  });

  it("allows everything without rules, and robots.txt itself always", () => {
    expect(robotsAllow(parseRobots("", "dossier"), "/anything")).toBe(true);
    expect(robotsAllow("all", "/x")).toBe(true);
    expect(robotsAllow("none", "/x")).toBe(false);
    expect(robotsAllow(parseRobots("User-agent: *\nDisallow: /", "dossier"), "/robots.txt")).toBe(true);
    expect(robotsAllow(parseRobots("User-agent: *\nDisallow: /", "dossier"), "/careers")).toBe(false);
  });
});
