import { describe, expect, it } from "vitest";

import { baseDomain, companyDomains, companyKey, matchMail, worthSuggesting, type MatchableApplication } from "./matching";

const app = (extra: Partial<MatchableApplication> & { id: string }): MatchableApplication => ({
  company: "",
  status: "SENT",
  postingText: "",
  emailTo: "",
  updatedAt: new Date("2026-10-10"),
  ...extra,
});

const northwind = app({ id: "nw", company: "Northwind Logistics GmbH", postingText: "Send your application to careers@jobs.northwind.example." });
const ledgerly = app({ id: "lg", company: "Ledgerly", emailTo: "John Doe <john@ledgerly.example>", status: "SCREENING" });
const draft = app({ id: "draft", company: "Contoso", status: "DRAFT" });
const all = [northwind, ledgerly, draft];
const mail = (extra: Partial<Parameters<typeof matchMail>[0]>) => ({ threadId: "t-new", fromName: "", fromAddress: "", subject: "", ...extra });

describe("matchMail", () => {
  it("matches a thread Dossier sent first", () => {
    expect(matchMail(mail({ threadId: "t1", fromAddress: "someone@gmail.com" }), all, new Map([["t1", "lg"]]))).toEqual({ applicationId: "lg", by: "thread" });
  });

  it("matches the company's mail domain, subdomains included", () => {
    expect(matchMail(mail({ fromAddress: "a.keller@northwind.example" }), all, new Map())).toEqual({ applicationId: "nw", by: "domain" });
    expect(matchMail(mail({ fromAddress: "john@ledgerly.example" }), all, new Map())).toEqual({ applicationId: "lg", by: "domain" });
  });

  it("matches the company's name for applicant tracking systems", () => {
    expect(matchMail(mail({ fromName: "Ledgerly Recruiting", fromAddress: "no-reply@greenhouse.io" }), all, new Map())).toEqual({ applicationId: "lg", by: "company" });
    const ats = { fromAddress: "no-reply@greenhouse.io" };
    expect(matchMail(mail({ ...ats, subject: "Your application at Northwind Logistics" }), all, new Map())?.applicationId).toBe("nw");
    expect(matchMail(mail({ ...ats, fromName: "NorthwindLogistics Talent" }), all, new Map())?.applicationId).toBe("nw");
    expect(matchMail(mail({ fromAddress: "jobs@northwindlogistics.example" }), all, new Map())?.applicationId).toBe("nw");
  });

  it("matches a company's name only as whole words", () => {
    const vita = app({ id: "vita", company: "Vita" });
    const rapp = app({ id: "rapp", company: "Rapp" });
    const ats = { fromAddress: "no-reply@talent.example" };
    expect(matchMail(mail({ ...ats, subject: "Interview invitation – Data Engineer" }), [vita, rapp], new Map())).toBeNull();
    expect(matchMail(mail({ ...ats, subject: "Your application" }), [vita, rapp], new Map())).toBeNull();
    expect(matchMail(mail({ ...ats, subject: "Northwind is hiring" }), [northwind], new Map())).toBeNull();
    expect(matchMail(mail({ ...ats, subject: "Your interview with Vita" }), [vita, rapp], new Map())?.applicationId).toBe("vita");
  });

  it("doesn't match free mail, drafts or unknown companies", () => {
    expect(matchMail(mail({ fromAddress: "friend@gmail.com", subject: "Lunch?" }), all, new Map())).toBeNull();
    expect(matchMail(mail({ fromName: "Contoso Talent", fromAddress: "x@ats.example" }), all, new Map())).toBeNull();
    expect(matchMail(mail({ fromAddress: "hr@fabrikam.example" }), all, new Map())).toBeNull();
  });

  it("prefers an application in progress when several share a domain", () => {
    const older = app({ id: "old", company: "Ledgerly", emailTo: "jobs@ledgerly.example", status: "REJECTED", updatedAt: new Date("2026-10-15") });
    expect(matchMail(mail({ fromAddress: "hr@ledgerly.example" }), [older, ledgerly], new Map())?.applicationId).toBe("lg");
  });

  it("never matches a new mail to a closed application, but keeps a thread already linked to one (#358)", () => {
    const closed = app({ id: "old", company: "Ledgerly", emailTo: "jobs@ledgerly.example", status: "REJECTED", updatedAt: new Date("2026-11-15") });
    expect(matchMail(mail({ fromAddress: "hr@ledgerly.example" }), [closed], new Map())).toBeNull();
    expect(matchMail(mail({ fromAddress: "hr@ledgerly.example", threadId: "t-old" }), [closed], new Map([["t-old", "old"]]))).toEqual({ applicationId: "old", by: "thread" });
  });
});

describe("domains and names", () => {
  it("finds the part of a domain a company owns", () => {
    expect(baseDomain("jobs.northwind.example")).toBe("northwind.example");
    expect(baseDomain("mail.acme.co.uk")).toBe("acme.co.uk");
    expect([...companyDomains({ postingText: "Write to a@gmail.com or b@careers.acme.example", emailTo: "" })]).toEqual(["acme.example"]);
  });

  it("drops legal forms from company names", () => {
    expect(companyKey("Northwind Logistics GmbH")).toBe("northwindlogistics");
    expect(companyKey("The Acme Co.")).toBe("acme");
  });
});

describe("worthSuggesting", () => {
  it("moves forward, or closes with a rejection, never back", () => {
    expect(worthSuggesting("SENT", "INTERVIEW")).toBe(true);
    expect(worthSuggesting("INTERVIEW", "SCREENING")).toBe(false);
    expect(worthSuggesting("SCREENING", "REJECTED")).toBe(true);
    expect(worthSuggesting("REJECTED", "INTERVIEW")).toBe(false);
    expect(worthSuggesting("SENT", null)).toBe(false);
    expect(worthSuggesting("OFFER", "OFFER")).toBe(false);
  });
});
