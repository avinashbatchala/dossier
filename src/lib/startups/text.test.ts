import { describe, expect, it } from "vitest";

import {
  companySite,
  decodeEntities,
  domainOf,
  emailLabel,
  emailOnDomain,
  findEmails,
  firstLine,
  firstLink,
  headerParts,
  htmlToText,
  noApplicationsSentence,
  withoutAddresses,
} from "./text";

describe("reading startups' text (#222)", () => {
  it("turns HTML into text with its links and entities", () => {
    expect(decodeEntities("A &amp; B &#x2F; C &#39;D&#39; &bogus;")).toBe("A & B / C 'D' &bogus;");
    expect(htmlToText('<p>Hi <a href="https:&#x2F;&#x2F;acme.com">our site</a></p><p>Apply: <a href="https://acme.com/jobs">https://acme.com/jobs</a><script>x()</script></p>')).toBe(
      "Hi our site (https://acme.com)\nApply: https://acme.com/jobs",
    );
  });

  it("finds written-out addresses, but not hidden ones or desks that aren't for applying", () => {
    expect(findEmails("Mail jobs@acme.com or Jane.Doe@Acme.com. Not support@acme.com, logo@2x.png or noreply@acme.com.")).toEqual(["jobs@acme.com", "jane.doe@acme.com"]);
    expect(findEmails("jane [at] acme [dot] com, jane(at)acme.com, jane at acme dot com")).toEqual([]);
  });

  it("tells application, founders' and general addresses from people's own", () => {
    expect(emailLabel("careers@acme.com")).toBe("Hiring");
    expect(emailLabel("bewerbung@acme.de")).toBe("Hiring");
    expect(emailLabel("founders@acme.com")).toBe("Founders");
    expect(emailLabel("hello@acme.com")).toBe("General");
    expect(emailLabel("jane@acme.com")).toBe("Person");
  });

  it("reads domains, and whether an address belongs to one", () => {
    expect(domainOf("https://www.Acme.com/careers")).toBe("acme.com");
    expect(domainOf("mailto:jobs@acme.com")).toBe("");
    expect(domainOf("not a link")).toBe("");
    expect(emailOnDomain("jobs@acme.com", "acme.com")).toBe(true);
    expect(emailOnDomain("jobs@eu.acme.com", "acme.com")).toBe(true);
    expect(emailOnDomain("jobs@notacme.com", "acme.com")).toBe(false);
    expect(emailOnDomain("jobs@acme.com", "")).toBe(false);
  });

  it("finds the startup's own site, not a job board's", () => {
    expect(companySite("https://www.acme.com/careers?x=1")).toBe("https://www.acme.com");
    expect(companySite("https://job-boards.greenhouse.io/acme/jobs/1")).toBe("");
    expect(companySite("https://www.ycombinator.com/companies/acme/jobs/x")).toBe("");
    expect(companySite("nope")).toBe("");
  });

  it("reads links, first lines and hiring post headers", () => {
    expect(firstLink("See https://acme.com/jobs. Thanks")).toBe("https://acme.com/jobs");
    expect(firstLink("no link")).toBe("");
    expect(firstLine("\n\nFirst line\nsecond")).toBe("First line");
    expect(firstLine("x".repeat(30), 10)).toBe("xxxxxxxxx…");
    expect(headerParts("Acme | Senior Engineer — Berlin or REMOTE (EU) - Full-time\nMore")).toEqual(["Acme", "Senior Engineer", "Berlin or REMOTE (EU)", "Full-time"]);
  });

  it("takes every address out of what the AI gets, written or hidden", () => {
    const text = "Write to jobs@acme.com, jane [at] acme [dot] com, bob(at)acme.com, carl at acme dot com, or mailto:dan@acme.com. Ask about our stack at the meetup.";
    const clean = withoutAddresses(text);
    expect(clean).not.toMatch(/acme/);
    expect(clean).toContain("Ask about our stack at the meetup.");
  });

  it("reads long, broken pages quickly", () => {
    const page = `${"<".repeat(50_000)}${"a.".repeat(50_000)}`;
    const started = performance.now();
    htmlToText(page);
    findEmails(page);
    withoutAddresses(page);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("notices a page that takes no unsolicited applications, but not one about recruiters", () => {
    expect(noApplicationsSentence("Join us!\nWe do not accept unsolicited applications. Thanks.")).toBe("We do not accept unsolicited applications.");
    expect(noApplicationsSentence("Bitte keine Initiativbewerbungen.")).toBe("Bitte keine Initiativbewerbungen.");
    expect(noApplicationsSentence("Initiativbewerbungen sind leider nicht erwünscht")).toBe("Initiativbewerbungen sind leider nicht erwünscht");
    expect(noApplicationsSentence("Pas de candidatures spontanées.")).toBe("Pas de candidatures spontanées.");
    expect(noApplicationsSentence("Acme does not accept unsolicited resumes from recruiters or agencies.")).toBe("");
    expect(noApplicationsSentence("We love hearing from you.")).toBe("");
  });
});
