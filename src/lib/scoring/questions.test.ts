import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";
import { DEFAULT_WORKPLACE } from "@/lib/profile-workplace";

import { answersFromTyped, engineQuestions, scoringState, type ScoringProfile } from "./questions";
import type { Answer } from "./typesafe";

const base = demoProfile();
const data: ProfileData = {
  ...base,
  // Kept off resumes, but true: scoring reads them (M4).
  certifications: [{ id: "c1", name: "CPACC", issuer: "IAAP", year: 2023, month: 5, expiryYear: null, expiryMonth: null, credentialId: "XYZ-123", link: "https://verify.example/xyz", onResumes: false }],
  publications: [{ id: "p1", citation: "Doe, J. **Calm payouts.** 2024.", link: "https://doi.example/1", onResumes: false }],
  customSections: [
    { id: "s1", title: "Freelance", format: "ENTRIES", countsAs: "WORK_EXPERIENCE", items: [{ id: "i1", title: "Studio Doe", subtitle: "Owner", details: "Design for startups", link: "https://studio.example", onResumes: false, startYear: 2015, startMonth: 1, endYear: 2016, endMonth: 12, current: false }] },
    { id: "s2", title: "Courses", format: "LINES", countsAs: "EDUCATION", items: [{ id: "i2", title: "Service design, Copenhagen", subtitle: "", details: "", link: "", onResumes: true, startYear: null, startMonth: null, endYear: null, endMonth: null, current: false }] },
    { id: "s3", title: "Awards", format: "LINES", countsAs: "EXTRA_ACTIVITIES", items: [{ id: "i3", title: "Red Dot 2022", subtitle: "", details: "", link: "", onResumes: true, startYear: null, startMonth: null, endYear: null, endMonth: null, current: false }] },
  ],
};
const profile: ScoringProfile = { data, levels: { from: "senior", to: "lead" }, workplace: { ...DEFAULT_WORKPLACE, modes: ["HYBRID", "REMOTE"], radiusKm: 25, remoteOpenTo: "countries", remoteCountries: ["nl", "de"] } };
const posting = { title: "Senior Product Designer", company: "Ledgerly", place: "Amsterdam", remote: false, salary: "€80k", description: "- 5+ years of product design\n- Dutch is a plus" };

describe("scoringState (E25-1)", () => {
  const state = scoringState(posting, profile, new Date("2026-11-15"));
  const text = JSON.stringify(state);

  it("groups the profile by the factor that reads it, hidden items too, and custom sections by what they count as", () => {
    expect(state.candidate.workExperience.roles.map((role) => role.company)).toContain("Northwind Logistics");
    expect(state.candidate.workExperience.otherWork).toEqual([{ section: "Freelance", items: [{ title: "Studio Doe", subtitle: "Owner", dates: expect.any(String), details: ["Design for startups"] }] }]);
    expect(state.candidate.education.otherEducation).toEqual([{ section: "Courses", items: ["Service design, Copenhagen"] }]);
    expect(state.candidate.extraActivities.otherActivities).toEqual([{ section: "Awards", items: ["Red Dot 2022"] }]);
    expect(state.candidate.extraActivities.certifications).toEqual([{ name: "CPACC", issuer: "IAAP", obtained: expect.any(String) }]);
    expect(state.candidate.extraActivities.publications).toEqual(["Doe, J. Calm payouts. 2024."]);
  });

  it("gives seniority the levels and years counted in code, and location where the profile works", () => {
    expect(state.candidate.seniority).toMatchObject({ levels: "Senior to Lead or director", yearsOfPaidWork: expect.any(Number) });
    expect(state.candidate.location).toEqual({
      livesIn: [base.basics.city, base.basics.country].filter(Boolean).join(", "),
      waysOfWorking: ["Hybrid", "Remote"],
      onSiteOrHybrid: { withinKmOfHome: 25, otherPlaces: [] },
      remoteForEmployersIn: ["NL", "DE"],
      willingToMove: false,
    });
  });

  it("never sends the name, contact details, references, links or credential ids", () => {
    for (const secret of [base.basics.name, base.basics.email, base.basics.phone, "linkedin.com", "XYZ-123", "verify.example", "doi.example", "studio.example", ...base.references.map((reference) => reference.name)]) {
      expect(text).not.toContain(secret);
    }
  });
});

const score = (value: number): Answer => ({ type: "score", score: value, confidence: 0.8, probabilities: {} });
const noul = (value: number): Answer => ({ type: "noul", noul: value });
const choice = (value: string): Answer => ({ type: "choice", choice: value, confidence: 0.8, probabilities: {} });
const fail = (detail: string) => new Error(detail);

describe("engineQuestions and answersFromTyped", () => {
  const lines = ["5+ years of product design", "Dutch is a plus", "We have a great office"];
  const typed: Record<string, Answer> = {
    line0Kind: choice("must"),
    line0Covered: noul(0.9),
    line1Kind: choice("nice"),
    line1Covered: noul(0.2),
    line2Kind: choice("other"),
    line2Covered: noul(0.1),
    work: score(3),
    extra: score(1.4),
    education: score(2),
    seniority: choice("above"),
    location: choice("fits"),
    thin: noul(0.1),
  };

  it("asks two questions per line, then the five factors and whether the posting is thin", () => {
    expect(Object.keys(engineQuestions(lines))).toEqual(["line0Kind", "line0Covered", "line1Kind", "line1Covered", "line2Kind", "line2Covered", "work", "extra", "education", "seniority", "location", "thin"]);
    expect(engineQuestions(lines).work).toMatchObject({ type: "score", criteria: expect.arrayContaining([expect.stringMatching(/^Closely matching/)]) });
  });

  it("reads a decision model's answers, with each level's own words for a reason", () => {
    expect(answersFromTyped(typed, lines, fail)).toEqual({
      requirements: [
        { text: "5+ years of product design", mustHave: true, covered: true, evidence: null },
        { text: "Dutch is a plus", mustHave: false, covered: false, evidence: null },
      ],
      work: { value: 1, reason: "You've done this kind of work before, in a comparable role." },
      extra: { value: 1.4 / 3, reason: "Some of your extra activities are loosely related to this job." },
      education: { value: 1, reason: "Your education meets what the posting asks for, or it asks for none in particular." },
      seniority: { fit: "above", reason: "The role is a step above the levels this profile is for." },
      location: { fit: "fits", reason: "You can work where and how this job is." },
      thin: false,
    });
  });

  it("refuses an answer missing, of the wrong kind, or an unknown choice", () => {
    const missing = Object.fromEntries(Object.entries(typed).filter(([id]) => id !== "work"));
    expect(() => answersFromTyped(missing, lines, fail)).toThrow("no score answer for work");
    expect(() => answersFromTyped({ ...typed, thin: score(1) }, lines, fail)).toThrow("no noul answer for thin");
    expect(() => answersFromTyped({ ...typed, seniority: choice("senior") }, lines, fail)).toThrow("unknown choice for seniority");
  });
});
