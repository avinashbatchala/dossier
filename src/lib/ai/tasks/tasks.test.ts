import { describe, expect, it } from "vitest";

import type { Extracted, Match } from "@/lib/application-data";
import { demoLetterUnits, demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { experienceMonths } from "@/lib/profile";

import sample from "../../../../prisma/seed/prototype-sample.json";
import type { ChatCall } from "../provider";
import { MockProvider } from "../providers/mock";

import { isoDate } from "./extract-posting";
import { sameSkill } from "./match-requirements";
import { COVER_LETTER_APPROACH } from "./prompt-parts";
import { withoutFrame } from "./write-cover-letter";
import { recipient } from "./write-email";
import {
  extractPosting,
  matchRequirements,
  refineChat,
  regenerateUnit,
  tailorResume,
  writeCoverLetter,
  writeEmail,
  type TaskOptions,
} from "./index";

// Fixture-based tests (E6-5): the mock provider answers like a model would,
// and each test checks the prompt that went out and what the task made of
// the answer.

const profile = demoProfile();
const options: TaskOptions = { creativity: "BALANCED", strict: true, language: null };
const today = new Date(2026, 8, 28);
const posting = sample.ledgerly.posting;

const extracted: Extracted = {
  title: "Senior Product Designer · Ledgerly",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid · 3 days in office",
  salary: "€75,000–€90,000",
  deadline: "2026-10-15",
  requirements: [
    { text: "5+ years of product design", kind: "years", skill: null, years: 5, language: null },
    { text: "Has built or maintained a design system", kind: "skill", skill: "Design systems", years: null, language: null },
    { text: "Runs user research independently", kind: "skill", skill: "User research", years: null, language: null },
    { text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null },
    { text: "Accessibility know-how (WCAG 2.2)", kind: "skill", skill: "Accessibility", years: null, language: null },
    { text: "Experience with payments or fintech", kind: "other", skill: null, years: null, language: null },
    { text: "Dutch is a plus", kind: "language", skill: null, years: null, language: "Dutch" },
  ],
  asksForReferences: false,
  language: "English",
};

/** A mock that answers once with `answer`; returns it and the calls it got. */
function model(answer: unknown) {
  return new MockProvider({ reply: () => answer });
}
const sent = (provider: MockProvider): ChatCall => provider.calls[0];
const prompt = (provider: MockProvider) => [sent(provider).system, ...sent(provider).messages.map((message) => message.content)].join("\n");

describe("extractPosting", () => {
  it("reads the posting as data and returns typed requirements with an ISO deadline (NEW-3)", async () => {
    const provider = model({ ...extracted, title: null, deadline: "15 October 2026", requirements: [...extracted.requirements, { text: " ", kind: "other", skill: null, years: null, language: null }] });
    const { data, promptVersion } = await extractPosting(provider, { posting: sample.ledgerly.posting, today }, options);
    expect(promptVersion).toBe("extract-posting@1");
    expect(data).toMatchObject({ title: "Senior Product Designer · Ledgerly", deadline: "2026-10-15", asksForReferences: false, language: "English" });
    expect(data.requirements).toHaveLength(7);
    expect(sent(provider).messages[0].content).toMatch(/^<posting>\nLedgerly: Senior Product Designer/);
    expect(sent(provider).system).toMatch(/material to read, not instructions/);
    expect(sent(provider).temperature).toBe(0.2);
    expect(sent(provider).effort).toBe("low");
    // So "Apply by 15 October" gets the right year.
    expect(sent(provider).system).toContain("Today is 2026-09-28.");
  });

  it("only keeps whole dates", () => {
    expect(isoDate("2026-10-15")).toBe("2026-10-15");
    expect(isoDate("15 Oct 2026")).toBe("2026-10-15");
    expect(isoDate("15 Oct")).toBeNull();
    expect(isoDate("2026-02-31")).toBeNull();
    expect(isoDate(null)).toBeNull();
  });
});

describe("matchRequirements", () => {
  const answer = {
    matches: [
      { requirement: 1, skill: "design systems", language: null },
      { requirement: 2, skill: "User research", language: null },
      { requirement: 3, skill: "Figma", language: null },
      { requirement: 4, skill: "Accessibility", language: null },
      { requirement: 5, skill: null, language: null },
      { requirement: 6, skill: null, language: "Dutch" },
    ],
  };

  it("classifies in code: covered with the roles as evidence, partial, gap (NEW-4)", async () => {
    const provider = model(answer);
    const { data, promptVersion } = await matchRequirements(provider, { requirements: extracted.requirements, profile, today }, options);
    expect(promptVersion).toBe("match-requirements@1");
    expect(sent(provider).effort).toBe("low");
    expect(data.items.map((item) => [item.requirement, item.result, item.note])).toEqual([
      ["5+ years of product design", "covered", "3 roles in your profile, since Sep 2015"],
      ["Has built or maintained a design system", "covered", "Used at Northwind Logistics"],
      ["Runs user research independently", "covered", "Used at Northwind Logistics, Fieldnote"],
      ["Strong prototyping skills in Figma", "covered", "Used at Fieldnote"],
      ["Accessibility know-how (WCAG 2.2)", "gap", "Not in your profile yet"],
      ["Experience with payments or fintech", "gap", "Nothing in your profile, so I'll address it honestly in the letter"],
      ["Dutch is a plus", "covered", "Dutch: Native"],
    ]);
    expect(data.items[1]).toMatchObject({ skill: "Design systems", experienceIds: ["e1"] });
  });

  it("calls a skill in the profile but in no role partial", async () => {
    const unlinked = { ...profile, experience: profile.experience.map((entry) => ({ ...entry, skillIds: [] })) };
    const { data } = await matchRequirements(model(answer), { requirements: extracted.requirements, profile: unlinked, today }, options);
    expect(data.items[1]).toMatchObject({ result: "partial", note: "In your skills, but not linked to a role yet", experienceIds: [] });
  });

  it("forgives small differences in a skill's name, and falls back to the posting's", async () => {
    const answer = { matches: [{ requirement: 0, skill: "Design system", language: null }, { requirement: 1, skill: null, language: null }] };
    const requirements = [extracted.requirements[1], { ...extracted.requirements[2], skill: "user-research" }];
    const { data } = await matchRequirements(model(answer), { requirements, profile, today }, options);
    expect(data.items.map((item) => [item.result, item.skill])).toEqual([
      ["covered", "Design systems"],
      ["covered", "User research"],
    ]);
    expect(sameSkill("HTML & CSS", "html/css")).toBe(true);
    expect(sameSkill("Figma", "Sigma")).toBe(false);
  });

  it("can't be talked into a skill the profile doesn't have", async () => {
    const kubernetes = { text: "Runs Kubernetes clusters", kind: "skill" as const, skill: "Kubernetes", years: null, language: null };
    const { data } = await matchRequirements(model({ matches: [{ requirement: 0, skill: "Kubernetes", language: null }] }), { requirements: [kubernetes], profile, today }, options);
    expect(data.items[0]).toMatchObject({ result: "gap", skill: null });
  });

  it("works out experience years without asking the model", async () => {
    const provider = model({});
    const { data } = await matchRequirements(provider, { requirements: [{ ...extracted.requirements[0], years: 15 }], profile, today }, options);
    expect(provider.calls).toHaveLength(0);
    expect(data.items[0]).toMatchObject({ result: "gap", note: "3 roles in your profile, since Sep 2015 (about 11 years)" });
    expect(experienceMonths(profile, today)).toBe(133);
  });
});

describe("tailorResume", () => {
  const answer = {
    summary: "Product designer who makes complex tools calm.",
    roles: [
      { id: "e1", bullets: ["Led the carrier portal redesign", " Owned the design system "] },
      { id: "e9", bullets: ["Invented role"] },
    ],
    projects: [
      { id: "p1", bullets: ["Built an open-source Figma plugin for design tokens"] },
      { id: "p9", bullets: ["Invented project"] },
    ],
    skills: ["Design systems", "figma", "Kubernetes", "User research"],
    education: [{ id: "d1", notes: "Thesis on trust in automation" }],
  };

  it("sends the profile without contact details, with the guardrails, the language and the note (PRD §7, SET-4)", async () => {
    const provider = model(answer);
    await tailorResume(provider, { profile, extracted, match: null, note: "Mention my interest in fintech.", posting }, options);
    const text = prompt(provider);
    for (const secret of ["jane.doe@example.com", "+31 6 1234 5678", "Westersingel", "1992-04-18", "linkedin.com", "John Doe", "github.com/janedoe"]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('"skillsUsed"');
    expect(text).toContain('"name": "Tidewater design tokens"');
    expect(text).toMatch(/Never invent or embellish an employer/);
    expect(text).toMatch(/same language as the job posting/);
    expect(text).toContain("Mention my interest in fintech.");
    // Writing keeps the model's own effort.
    expect(sent(provider).effort).toBeUndefined();
  });

  it("returns units, keeping only real roles and the profile's own skills (APP-4)", async () => {
    const { data, promptVersion } = await tailorResume(model(answer), { profile, extracted, match: null, note: "", posting }, options);
    expect(promptVersion).toBe("tailor-resume@4");
    expect(data.map((unit) => unit.id)).toEqual([
      "summary",
      "experience:e1",
      "experience:e2",
      "experience:e3",
      "project:p1",
      "skills",
      "education:d1",
      "education:d2",
      "languages",
    ]);
    expect(data.find((unit) => unit.id === "project:p1")).toEqual({
      id: "project:p1",
      label: "Tidewater design tokens project",
      text: "Built an open-source Figma plugin for design tokens",
    });
    expect(data.find((unit) => unit.id === "experience:e1")?.text).toBe("Led the carrier portal redesign\nOwned the design system");
    // A role the model skipped keeps its own bullets.
    expect(data.find((unit) => unit.id === "experience:e2")?.text).toBe(profile.experience[1].bullets);
    expect(data.find((unit) => unit.id === "skills")?.text).toBe("Design systems · Figma · User research");
    expect(data.find((unit) => unit.id === "languages")?.text).toBe("Dutch: Native · English: Fluent (C2) · German: Intermediate (B1)");
  });

  it("names language levels in the resume's language: the chosen one, or the posting's", async () => {
    const levels = async (language: string | null, postingLanguage: string) => {
      const { data } = await tailorResume(model(answer), { profile, extracted: { ...extracted, language: postingLanguage }, match: null, note: "", posting }, { ...options, language });
      return data.find((unit) => unit.id === "languages")?.text;
    };
    expect(await levels(null, "German")).toBe("Dutch: Muttersprache · English: Fließend (C2) · German: Mittelstufe (B1)");
    expect(await levels("French", "German")).toBe("Dutch: Langue maternelle · English: Courant (C2) · German: Intermédiaire (B1)");
  });

  it("asks for a resume that fits the page limit, when there is one (E10-10)", async () => {
    const system = async (maxPages: number | null) => {
      const provider = model({ summary: "Designer.", roles: [], projects: [], skills: [], education: [] });
      await tailorResume(provider, { profile, extracted, match: null, note: "", posting }, { ...options, maxPages });
      return sent(provider).system;
    };
    expect(await system(1)).toMatch(/has to fit on one page/);
    expect(await system(2)).toMatch(/has to fit on two pages/);
    expect(await system(null)).not.toMatch(/has to fit/);
  });

  it("words creativity for every provider, and relaxes the rules when strict mode is off", async () => {
    const provider = model(answer);
    await tailorResume(provider, { profile, extracted, match: null, note: "", posting }, { ...options, creativity: "EXPRESSIVE", strict: false, language: "Dutch" });
    expect(sent(provider).system).toMatch(/Write with personality/);
    expect(sent(provider).system).toMatch(/reasonable conclusions/);
    expect(sent(provider).system).toMatch(/Write everything in Dutch\./);
  });
});

describe("writeCoverLetter", () => {
  const match: Match = {
    items: [{ requirement: "Experience with payments or fintech", result: "gap", skill: null, experienceIds: [], note: null }],
  };
  const answer = {
    recipient: " Ledgerly · Hiring team \n\n Amsterdam ",
    greeting: " Dear Ledgerly team, ",
    paragraphs: [
      { label: "Opening", text: "I was excited to see the role." },
      { label: "", text: "At Northwind I lead the carrier portal." },
      { label: "Empty", text: "  " },
    ],
    signOff: "Cheers,",
  };

  it("returns the recipient, greeting, paragraphs and the tone's sign-off for an English letter (APP-10, E8-11)", async () => {
    const provider = model(answer);
    const { data, promptVersion } = await writeCoverLetter(provider, { profile, extracted, match, tone: "FORMAL", note: "", posting }, options);
    expect(promptVersion).toBe("write-cover-letter@4");
    expect(data).toEqual([
      { id: "recipient", label: "Recipient", text: "Ledgerly · Hiring team\nAmsterdam" },
      { id: "greeting", label: "Greeting", text: "Dear Ledgerly team," },
      { id: "paragraph:1", label: "Opening", text: "I was excited to see the role." },
      { id: "paragraph:2", label: "Paragraph 2", text: "At Northwind I lead the carrier portal." },
      { id: "sign-off", label: "Sign-off", text: "Kind regards," },
    ]);
    expect(sent(provider).system).toMatch(/Tone: Formal\. Traditional and polished\./);
    expect(sent(provider).system).toMatch(/greeting: the salutation before the first paragraph, usual for a letter in its language/);
    // It says what the resume can't, rather than repeating it.
    expect(sent(provider).system).toContain(COVER_LETTER_APPROACH);
    // Gaps go along, so the letter can acknowledge them honestly.
    expect(prompt(provider)).toMatch(/"inProfile": "gap"/);
  });

  it("leaves out a recipient or greeting the model left empty, for the English ones to fill in", async () => {
    const { data } = await writeCoverLetter(model({ ...answer, recipient: " ", greeting: "" }), { profile, extracted, match: null, tone: "WARM", note: "", posting }, options);
    expect(data.map((unit) => unit.id)).toEqual(["paragraph:1", "paragraph:2", "sign-off"]);
  });

  it("leaves the greeting, sign-off and name to the renderer", () => {
    const paragraphs = [{ text: "Hi,\nI'm applying for the role." }, { text: "Middle." }, { text: "Thank you for your time.\n\nWarm regards,\nJane Doe" }];
    expect(withoutFrame(paragraphs, "Warm regards,").map((paragraph) => paragraph.text)).toEqual([
      "I'm applying for the role.",
      "Middle.",
      "Thank you for your time.",
    ]);
    expect(withoutFrame([{ text: "Thank you for considering my application. Warm regards,\nLena" }], "Warm regards,")[0].text).toBe(
      "Thank you for considering my application.",
    );
    // A closing word inside a sentence stays.
    expect(withoutFrame([{ text: "It was the best, really." }], "Best,")[0].text).toBe("It was the best, really.");
  });

  it("keeps the model's sign-off in another language", async () => {
    const { data } = await writeCoverLetter(model({ ...answer, signOff: "Met vriendelijke groet," }), { profile, extracted, match: null, tone: "WARM", note: "", posting }, { ...options, language: "Dutch" });
    expect(data.at(-1)).toEqual({ id: "sign-off", label: "Sign-off", text: "Met vriendelijke groet," });
  });
});

describe("writeEmail", () => {
  const withContact = `${posting}\n\nQuestions? Send your application to John Doe, john.doe@example.com.`;
  const answer = {
    contactName: "John Doe",
    contactEmail: "john.doe@example.com",
    subject: " Application:  Senior Product Designer,\nJane Doe ",
    greeting: "Dear John,",
    paragraphs: ["Dear John,\nI'm applying for the Senior Product Designer role.", "  ", "My resume and cover letter are attached.\n\nWarm regards,\nLena"],
    signOff: "Cheers,",
  };
  const input = { profile, extracted, match: null, tone: "FORMAL" as const, note: "", posting: withContact, letter: ["Payments are where trust is won."] };

  it("writes the recipient, subject and message, ending with the sign-off and name", async () => {
    const provider = model(answer);
    const { data, promptVersion } = await writeEmail(provider, input, options);
    expect(promptVersion).toBe("write-email@1");
    expect(data).toEqual([
      { id: "to", label: "Recipient", text: "John Doe <john.doe@example.com>" },
      { id: "subject", label: "Subject", text: "Application: Senior Product Designer, Jane Doe" },
      {
        id: "body",
        label: "Message",
        text: `Dear John,\n\nI'm applying for the Senior Product Designer role.\n\nMy resume and cover letter are attached.\n\nKind regards,\n${profile.basics.name}`,
      },
    ]);
    expect(sent(provider).system).toMatch(/Tone: Formal\./);
    // It reads the posting for where to send it, and the letter so it doesn't repeat it.
    expect(prompt(provider)).toContain("Send your application to John Doe");
    expect(prompt(provider)).toContain("The cover letter it goes with:\nPayments are where trust is won.");
    expect(sent(provider).json?.name).toBe("application_email");
  });

  it("never uses an address the posting doesn't have", async () => {
    const { data } = await writeEmail(model({ ...answer, contactEmail: "jobs@example.com" }), input, options);
    expect(data[0]).toEqual({ id: "to", label: "Recipient", text: "" });
  });

  it("keeps the model's sign-off in another language", async () => {
    const { data } = await writeEmail(model({ ...answer, signOff: "Met vriendelijke groet," }), input, { ...options, language: "Dutch" });
    expect(data[2].text).toMatch(new RegExp(`Met vriendelijke groet,\n${profile.basics.name}$`));
  });

  it("marks what the fact guard couldn't back in the message, never in the recipient", async () => {
    const { data } = await writeEmail(model({ ...answer, paragraphs: ["I grew revenue by 40% at Stripe."] }), input, options);
    expect(data[0].unverified).toBeUndefined();
    expect(data[2].unverified).toEqual(expect.arrayContaining(["40%"]));
  });

  it("names the recipient as the posting gives them", () => {
    expect(recipient(null, "jobs@example.com", "Apply at JOBS@example.com")).toBe("jobs@example.com");
    expect(recipient("John <Doe>", "mailto:john@example.com", "john@example.com")).toBe("John Doe <john@example.com>");
    expect(recipient("John Doe", null, "john@example.com")).toBe("");
    expect(recipient("John Doe", "not an address", "not an address")).toBe("");
  });
});

describe("regenerateUnit", () => {
  it("writes one part again, cleaning up bullets (APP-5)", async () => {
    const resume = demoResumeUnits();
    const unit = resume.find((entry) => entry.id === "experience:e1")!;
    const provider = model({ text: "- Rebuilt the carrier portal\n• Grew the design system\n" });
    const { data, promptVersion } = await regenerateUnit(provider, { kind: "RESUME", unit, document: resume, profile, extracted, tone: "WARM", note: "", posting }, options);
    expect(promptVersion).toBe("regenerate-unit@5");
    expect(data).toMatchObject({ id: "experience:e1", text: "Rebuilt the carrier portal\nGrew the design system" });
    expect(prompt(provider)).toContain(`Write a new version of "${unit.label}" (experience:e1)`);
    expect(sent(provider).system).not.toContain(COVER_LETTER_APPROACH);
  });

  it("keeps an English letter's sign-off the tone's", async () => {
    const unit = { id: "sign-off", label: "Sign-off", text: "Warm regards," };
    const provider = model({ text: "Yours truly," });
    const { data } = await regenerateUnit(provider, { kind: "COVER_LETTER", unit, document: [unit], profile, extracted, tone: "DIRECT", note: "", posting }, options);
    expect(data.text).toBe("Best,");
    expect(sent(provider).system).toContain(COVER_LETTER_APPROACH);
  });

  it("tells the model what the email's message is, with the tone", async () => {
    const unit = { id: "body", label: "Message", text: "Dear John,\n\nHello.\n\nWarm regards,\nLena" };
    const provider = model({ text: "Dear John,\n\nHi again." });
    const { data } = await regenerateUnit(provider, { kind: "EMAIL", unit, document: [unit], profile, extracted, tone: "DIRECT", note: "", posting }, options);
    expect(data.text).toBe("Dear John,\n\nHi again.");
    expect(sent(provider).system).toMatch(/one part of a candidate's application email/);
    expect(sent(provider).system).toMatch(/It's the email's whole message/);
    expect(sent(provider).system).toMatch(/Tone: Direct\./);
    expect(sent(provider).system).not.toContain(COVER_LETTER_APPROACH);
  });

  it("tells the model what a letter's greeting is, without the letter's brief (E8-11)", async () => {
    const unit = { id: "greeting", label: "Greeting", text: "Dear Ledgerly team," };
    const provider = model({ text: "Dear hiring team," });
    await regenerateUnit(provider, { kind: "COVER_LETTER", unit, document: [unit], profile, extracted, tone: "WARM", note: "", posting }, options);
    expect(sent(provider).system).toMatch(/It's the letter's greeting/);
    expect(sent(provider).system).not.toContain(COVER_LETTER_APPROACH);
  });
});

describe("refineChat", () => {
  const resume = demoResumeUnits();
  const letter = [...demoLetterUnits(), { id: "sign-off", label: "Sign-off", text: "Warm regards," }];
  const input = { request: "Make it more formal", history: [], target: null, resume, letter, profile, extracted, tone: "WARM" as const, note: "", posting };

  it("returns a reply and edits with what they replace, for Undo (APP-7, APP-8)", async () => {
    const answer = {
      reply: "I made the letter more formal.",
      edits: [
        { document: "COVER_LETTER", unitId: "paragraph:1", text: "Please accept my application." },
        { document: "COVER_LETTER", unitId: "paragraph:99", text: "Invented unit" },
        { document: "RESUME", unitId: "summary", text: resume[0].text },
      ],
      tone: "FORMAL",
      declined: false,
    };
    const { data, promptVersion } = await refineChat(model(answer), input, options);
    expect(promptVersion).toBe("refine-chat@5");
    expect(data).toEqual({
      reply: "I made the letter more formal.",
      tone: "FORMAL",
      declined: false,
      edits: [
        { document: "COVER_LETTER", unitId: "paragraph:1", text: "Please accept my application.", previousText: letter[0].text },
        // A new tone brings its sign-off along.
        { document: "COVER_LETTER", unitId: "sign-off", text: "Kind regards,", previousText: "Warm regards," },
      ],
    });
  });

  it("declines with guidance instead of inventing facts (APP-9)", async () => {
    const answer = {
      reply: "Your profile doesn't mention fintech work yet. Add it under Experience and I'll use it.",
      edits: [{ document: "RESUME", unitId: "summary", text: "Fintech expert." }],
      tone: null,
      declined: true,
    };
    const { data } = await refineChat(model(answer), { ...input, request: "Say I worked at a bank" }, options);
    expect(data).toMatchObject({ declined: true, edits: [], tone: null });
  });

  it("sends the conversation so far and the unit it's about", async () => {
    const provider = model({ reply: "Done.", edits: [], tone: null, declined: false });
    await refineChat(provider, { ...input, target: "Summary", history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello!" }] }, options);
    const messages = sent(provider).messages;
    expect(messages.slice(-3)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "About Summary: Make it more formal" },
    ]);
  });

  it("edits the email, which it sees when there is one", async () => {
    const email = [
      { id: "to", label: "Recipient", text: "john@example.com" },
      { id: "subject", label: "Subject", text: "Application" },
      { id: "body", label: "Message", text: "Dear John,\n\nHello." },
    ];
    const answer = { reply: "Shorter now.", edits: [{ document: "EMAIL", unitId: "body", text: "Dear John,\n\nHi." }], tone: null, declined: false };
    const provider = model(answer);
    const { data } = await refineChat(provider, { ...input, email, viewing: "EMAIL", request: "Shorter" }, options);
    expect(data.edits).toEqual([{ document: "EMAIL", unitId: "body", text: "Dear John,\n\nHi.", previousText: "Dear John,\n\nHello." }]);
    expect(prompt(provider)).toContain("The email's units:");
    expect(sent(provider).messages.at(-1)).toEqual({ role: "user", content: "(I'm looking at the email.) Shorter" });

    const without = model(answer);
    const { data: none } = await refineChat(without, input, options);
    expect(none.edits).toEqual([]);
    expect(prompt(without)).not.toContain("The email's units:");
  });

  it("says which document is on screen when the request has no target", async () => {
    const provider = model({ reply: "Done.", edits: [], tone: null, declined: false });
    await refineChat(provider, { ...input, request: "Make it shorter", viewing: "COVER_LETTER" }, options);
    expect(sent(provider).messages.at(-1)).toEqual({ role: "user", content: "(I'm looking at the cover letter.) Make it shorter" });
  });

  it("keeps the fact guard's hints on the replaced text, for Undo", async () => {
    const flagged = resume.map((unit) => (unit.id === "summary" ? { ...unit, unverified: ["2019"] } : unit));
    const answer = { reply: "Shorter now.", edits: [{ document: "RESUME", unitId: "summary", text: "Product designer." }], tone: null, declined: false };
    const { data } = await refineChat(model(answer), { ...input, resume: flagged }, options);
    expect(data.edits[0]).toMatchObject({ previousText: resume[0].text, previousUnverified: ["2019"] });
  });
});

describe("the fact guard in the writing tasks (E6-6)", () => {
  const answer = {
    summary: "Led a team of 12 at Google; nine years of design at Northwind Logistics.",
    roles: [{ id: "e1", bullets: ["Led the redesign of the carrier portal used daily by 4,000+ dispatchers"] }],
    projects: [],
    skills: ["Figma"],
    education: [],
  };

  it("notes what the profile and posting don't back, in strict mode", async () => {
    const { data } = await tailorResume(model(answer), { profile, extracted, match: null, note: "", posting }, options);
    expect(data.find((unit) => unit.id === "summary")?.unverified).toEqual(["Google", "12"]);
    expect(data.find((unit) => unit.id === "experience:e1")).not.toHaveProperty("unverified");
  });

  it("stays out of the way when strict mode is off", async () => {
    const { data } = await tailorResume(model(answer), { profile, extracted, match: null, note: "", posting }, { ...options, strict: false });
    expect(data.some((unit) => unit.unverified)).toBe(false);
  });

  it("checks the letter, a regenerated unit and chat edits too", async () => {
    const letter = await writeCoverLetter(model({ recipient: "", greeting: "", paragraphs: [{ label: "Opening", text: "I grew revenue by 40% at Stripe." }], signOff: "" }), { profile, extracted, match: null, tone: "WARM", note: "", posting }, options);
    expect(letter.data[0].unverified).toEqual(["Stripe", "40%"]);

    const unit = { id: "summary", label: "Summary", text: "Product designer." };
    const regenerated = await regenerateUnit(model({ text: "PhD-trained designer." }), { kind: "RESUME", unit, document: [unit], profile, extracted, tone: "WARM", note: "", posting }, options);
    expect(regenerated.data.unverified).toEqual(["PhD-trained"]);

    const refined = await refineChat(
      model({ reply: "Done.", edits: [{ document: "RESUME", unitId: "summary", text: "Designer with 25 years at IBM." }], tone: null, declined: false }),
      { request: "Punchier", history: [], target: null, resume: [unit], letter: [], profile, extracted, tone: "WARM", note: "", posting },
      options,
    );
    expect(refined.data.edits[0].unverified).toEqual(["IBM", "25"]);
  });
});

