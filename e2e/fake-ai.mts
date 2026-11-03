// A stand-in for an OpenAI-compatible AI server (E11-2), started by
// playwright.config.ts. It answers each task by its JSON schema's name with
// plausible output built from the prompt, like the mock provider in the unit
// tests, so the app's real provider code runs end to end.

import { createServer } from "node:http";

type Message = { role: string; content: string };
type Request = { messages: Message[]; response_format?: { json_schema?: { name?: string } } };

const port = Number(process.env.FAKE_AI_PORT ?? 3999);

/** The JSON after `label` in a message, up to the next blank line and label. */
function section(text: string, label: string): unknown {
  const start = text.indexOf(label);
  if (start < 0) return null;
  const rest = text.slice(start + label.length);
  const end = rest.search(/\n\n[A-Z][^\n]*:\n/);
  return JSON.parse(end < 0 ? rest : rest.slice(0, end));
}

type Profile = {
  summary: string;
  skills: string[];
  experience: { id: string; bullets: string[] }[];
  projects: { id: string; bullets: string[] }[];
  education: { id: string; notes: string }[];
};
type Unit = { id: string; label: string; text: string };

/** Emails written so far, so writing again gives a different one. */
let emails = 0;
/** The last request's messages, for specs that check what a prompt carried (GET /last). */
let last: Message[] = [];

const answers: Record<string, (messages: Message[]) => unknown> = {
  extracted_posting: () => ({
    title: "Senior Product Designer, Payments · Ledgerly",
    company: "Ledgerly",
    role: "Senior Product Designer, Payments",
    location: "Amsterdam",
    mode: "Hybrid · 3 days in office",
    salary: "€75,000–€90,000",
    deadline: null,
    requirements: [
      { text: "5+ years of product design", kind: "years", skill: null, years: 5, language: null },
      { text: "Built or maintained a design system", kind: "skill", skill: "Design systems", years: null, language: null },
      { text: "Strong prototyping skills in Figma", kind: "skill", skill: "Figma", years: null, language: null },
      { text: "Experience with Kubernetes", kind: "skill", skill: "Kubernetes", years: null, language: null },
      { text: "Dutch is a plus", kind: "language", skill: null, years: null, language: "Dutch" },
    ],
    asksForReferences: false,
    language: "English",
  }),

  requirement_matches: (messages) => {
    const { requirements, candidateSkills, candidateLanguages } = JSON.parse(messages[1].content) as {
      requirements: { number: number; text: string; skill: string | null }[];
      candidateSkills: string[];
      candidateLanguages: string[];
    };
    return {
      matches: requirements.map((requirement) => ({
        requirement: requirement.number,
        skill: candidateSkills.find((name) => name.toLowerCase() === requirement.skill?.toLowerCase()) ?? null,
        language: candidateLanguages.find((name) => requirement.text.includes(name)) ?? null,
      })),
    };
  },

  tailored_resume: (messages) => {
    const profile = section(messages[1].content, "The candidate's profile:\n") as Profile;
    return {
      summary: profile.summary,
      roles: profile.experience.map((entry) => ({ id: entry.id, bullets: entry.bullets })),
      projects: profile.projects.map((entry) => ({ id: entry.id, bullets: entry.bullets })),
      skills: profile.skills,
      education: profile.education.map((entry) => ({ id: entry.id, notes: entry.notes })),
    };
  },

  // The job agent's score (E16): by the posting's title, so a spec knows
  // which postings make the queue (70 is the default minimum) and which don't.
  posting_score: (messages) => {
    const { title } = section(messages[1].content, "The posting's facts:\n") as { title: string };
    const score = /senior product designer/i.test(title) ? 91 : /product designer/i.test(title) ? 78 : 45;
    return {
      score,
      reasons: [score >= 70 ? `The profile's product design roles match "${title}".` : `"${title}" is further from the profile's roles.`],
      redFlags: score >= 70 ? [] : ["The profile shows no UX research lead role."],
    };
  },

  cover_letter: () => ({
    recipient: "Ledgerly · Hiring team\nAmsterdam",
    greeting: "Dear Ledgerly team,",
    paragraphs: [
      { label: "Opening", text: "Payments are where trust is won or lost, and I'd love to help Ledgerly's customers feel calm about them." },
      { label: "Experience", text: "At Northwind Logistics I led the design of complex operational tools, from research to shipped flows." },
      { label: "Closing", text: "I'd be glad to talk about how I could help your Payments team." },
    ],
    signOff: "Warm regards,",
  }),

  application_email: () => ({
    contactName: "John Doe",
    contactEmail: "careers@example.com",
    subject: "Application: Senior Product Designer, Payments",
    greeting: "Dear John,",
    paragraphs: [
      emails++ === 0
        ? "I'm applying for the Senior Product Designer role on your Payments team."
        : "I'd love to help Ledgerly's customers feel calm about their payments as your Senior Product Designer.",
      "I've designed complex operational tools end to end, from research to shipped flows.",
      "My resume and cover letter are attached. I'd be glad to talk.",
    ],
    signOff: "Warm regards,",
  }),

  refinement: (messages) => {
    const request = messages.at(-1)!.content;
    if (/kubernetes/i.test(request)) {
      return { reply: "Your profile doesn't mention Kubernetes, so I left it out. Add it to your profile first.", edits: [], tone: null, declined: true };
    }
    if (request.includes("(I'm looking at the email.)")) {
      const email = section(messages[1].content, "The email's units:\n") as Unit[];
      const body = email.find((unit) => unit.id === "body")!;
      // Without the middle paragraph.
      const shorter = body.text.split("\n\n").filter((_, index) => index !== 2).join("\n\n");
      return { reply: "Done. I made the email shorter.", edits: [{ document: "EMAIL", unitId: "body", text: shorter }], tone: null, declined: false };
    }
    const resume = section(messages[1].content, "The resume's units:\n") as Unit[];
    const summary = resume.find((unit) => unit.id === "summary")!;
    const shorter = summary.text.split(/(?<=\.)\s+/)[0];
    return { reply: "Done. I made the summary shorter.", edits: [{ document: "RESUME", unitId: "summary", text: shorter }], tone: null, declined: false };
  },

  extracted_profile: () => ({
    basics: {
      name: "John Doe",
      headline: "Design Lead",
      email: "robin@example.com",
      phone: null,
      dob: null,
      website: null,
      address: null,
      city: "Utrecht",
      country: null,
      linkedin: null,
      summary: null,
    },
    skills: ["Figma", "Service design"],
    languages: [{ name: "Dutch", level: "NATIVE" }],
    experience: [
      {
        role: "Design Lead",
        company: "Acme Payments",
        location: "Utrecht",
        descriptor: "Payouts for online marketplaces, 60 people",
        startYear: 2021,
        startMonth: 3,
        endYear: null,
        endMonth: null,
        current: true,
        bullets: ["Led the redesign of the payout flow"],
        skills: ["Service design"],
      },
    ],
    projects: [],
    education: [],
    publications: [],
    references: [],
  }),

  // Gmail (E15): an employer's reply is an invitation that asks two things,
  // and the answer offers the times it's given and leaves the notice period open.
  classified_reply: () => ({
    kind: "INTERVIEW",
    summary: "Invites you to a 45-minute call next week and asks about your notice period.",
    questions: ["Which times would work for you?", "What is your notice period?"],
    confirmedTime: null,
  }),

  reply_draft: (messages) => {
    const times = (messages.at(-1)?.content ?? "").split("\n").filter((line) => line.startsWith("• "));
    return {
      greeting: "Hi John,",
      paragraphs: [
        times.length > 0 ? `Thank you, I'd be glad to talk. Any of these times works for me:\n${times.join("\n")}` : "Thank you, I'd be glad to talk.",
        "My notice period is […].",
      ],
      signOff: "Best regards,",
      gaps: ["What is your notice period?"],
    };
  },

  new_text: (messages) => {
    const current = messages[1].content.split("Its current text:\n").at(-1) ?? "";
    const lines = current.split("\n").filter(Boolean);
    return { text: lines.length > 1 ? lines.reverse().join("\n") : `In short: ${current}` };
  },
};

createServer((request, response) => {
  const send = (status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.method === "GET" && request.url === "/health") return send(200, { ok: true });
  if (request.method === "GET" && request.url === "/last") return send(200, { messages: last });
  if (request.method === "GET" && request.url === "/v1/models") {
    return send(200, { object: "list", data: [{ id: "fake-model", object: "model", created: 0, owned_by: "e2e" }] });
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") return send(404, { error: { message: "Not found" } });

  let raw = "";
  request.on("data", (chunk) => (raw += chunk));
  request.on("end", () => {
    const body = JSON.parse(raw) as Request;
    last = body.messages;
    const name = body.response_format?.json_schema?.name;
    const answer = name && answers[name];
    if (!answer) return send(400, { error: { message: `No fake answer for "${name}".` } });
    // A moment of "thinking", so progress shows as it would.
    setTimeout(() => {
      try {
        send(200, {
          id: "fake",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "fake-model",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer(body.messages)) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
      } catch (error) {
        send(500, { error: { message: String(error) } });
      }
    }, 300);
  });
}).listen(port, () => console.log(`Fake AI server on http://localhost:${port}`));
