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
