import { describe, expect, it } from "vitest";

import { demoLetterUnits, demoProfile, demoResumeUnits } from "@/lib/demo-profile";

import { summaryText, tailoringSummary } from "./tailoring-summary";

const profile = demoProfile();
const match = {
  items: [
    { requirement: "Strong prototyping skills in Figma", result: "covered" as const, skill: "Figma", experienceIds: ["e2"], note: "Used at Fieldnote" },
    { requirement: "Experience with payments or fintech", result: "gap" as const, skill: null, experienceIds: [], note: null },
  ],
};
const base = {
  profile,
  company: "Ledgerly",
  role: "Senior Product Designer",
  match,
  resume: demoResumeUnits(),
  letter: [...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Warm regards," }],
  tone: "WARM" as const,
  note: "",
  references: "not-asked" as const,
  strict: true,
  showChanges: true,
};

describe("tailoringSummary (E7-6)", () => {
  it("says what changed, worked out from the documents and the profile", () => {
    const summary = tailoringSummary(base);
    expect(summary.intro).toBe("Here's what I tailored for Ledgerly:");
    expect(summary.list).toEqual([
      "Rewrote your summary for the Senior Product Designer role",
      "Reworded your Northwind Logistics and Fieldnote roles for this job",
      "Ordered your skills by what Ledgerly asks for",
      "Left out references, since the posting doesn't ask for them",
      "Wrote a warm cover letter",
      "Worth being ready to talk about “Experience with payments or fintech”, since it isn't in your profile",
    ]);
    expect(summary.foot).toBe("Nothing invented: every line comes from your profile.");
  });

  it("mentions projects it reworded (PRO-13)", () => {
    const resume = demoResumeUnits().map((unit) => (unit.id === "project:p1" ? { ...unit, text: "Built a token pipeline for design teams" } : unit));
    expect(tailoringSummary({ ...base, resume }).list).toContain("Reworded your Tidewater design tokens project for this job");
  });

  it("only claims what happened", () => {
    const untouched = tailoringSummary({
      ...base,
      match: { items: [] },
      resume: [
        { id: "summary", label: "Summary", text: profile.basics.summary },
        ...profile.experience.map((entry) => ({ id: `experience:${entry.id}`, label: "", text: entry.bullets })),
        { id: "skills", label: "Skills", text: profile.skills.map((skill) => skill.name).join(" · ") },
      ],
      letter: [],
    });
    expect(untouched.list).toEqual(["Left out references, since the posting doesn't ask for them"]);
  });

  it("mentions skills left out, the note, and details to check", () => {
    const summary = tailoringSummary({
      ...base,
      resume: [
        { id: "summary", label: "Summary", text: "Designer.", unverified: ["Google", "12"] },
        { id: "skills", label: "Skills", text: "Figma · User research · Interaction design · Design systems" },
      ],
      note: "Lean on research.",
      references: "included",
    });
    expect(summary.list).toContain("Left out Prototyping, HTML & CSS and Workshop facilitation, which this job isn't about");
    expect(summary.list).toContain("Included your references, since the posting asks for them");
    expect(summary.list).toContain("Took your note into account: “Lean on research.”");
    expect(summary.list).toContain("Marked 2 details to check (not in your profile or the posting)");
    expect(summary.foot).toBe("Double-check the marked details before you send anything.");
  });

  it("stays short when “Show what changed” is off, and says when strict mode is off", () => {
    const summary = tailoringSummary({ ...base, showChanges: false, strict: false });
    expect(summary).toEqual({
      intro: "Your tailored resume and cover letter for Ledgerly are ready.",
      list: [],
      foot: "“Never invent experience” is off, so check the facts before you send anything.",
    });
    expect(summaryText(summary)).toBe(`${summary.intro}\n\n${summary.foot}`);
  });

  it("writes the message as a bulleted list", () => {
    expect(summaryText({ intro: "Here's what I tailored for Ledgerly:", list: ["One", "Two"], foot: "Nothing invented." })).toBe(
      "Here's what I tailored for Ledgerly:\n\n- One\n- Two\n\nNothing invented.",
    );
  });
});
