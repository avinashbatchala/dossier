import { z } from "zod";

import { extractedSchema, requirementSchema, type Extracted } from "@/lib/application-data";

import { postingForPrompt, system, UNTRUSTED_POSTING, type Task } from "./prompt-parts";

export const EXTRACT_POSTING_VERSION = "extract-posting@2";

// What the model returns. The deadline is free text here and checked in
// code, since models like to answer "15 Oct" rather than an ISO date. Small
// models leave out the keys of a requirement that don't apply, so those read as null.
const answerSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  location: z.string().nullable(),
  mode: z.string().nullable(),
  salary: z.string().nullable(),
  deadline: z.string().nullable(),
  requirements: z.array(
    requirementSchema.extend({
      skill: z.string().nullable().default(null),
      years: z.number().nullable().default(null),
      language: z.string().nullable().default(null),
    }),
  ),
  asksForReferences: z.boolean(),
  language: z.string().nullable(),
});

const INSTRUCTIONS = `You read job postings and pull out their details as JSON.

- Use only what the posting says; use null for anything it doesn't mention. Keep the posting's own wording for work mode and salary, e.g. "Hybrid · 3 days in office" or "€75,000–€90,000".
- location: the city or region only, e.g. "Amsterdam".
- company and role: the employer and the position as the posting names them, often in its heading or first lines; null only when it names none.
- title: "{role} · {company}", or null when either is missing.
- deadline: the application deadline as YYYY-MM-DD. When the posting gives no year, it's the first such date after today.
- requirements: one entry per thing the posting asks of the candidate, in its order, each shortened to the essentials (e.g. "5+ years of product design, ideally on complex B2B tools"). kind is:
  - "years" for an amount of experience, with years set to the number (5 for "5+ years");
  - "language" for a spoken language, with language set to its English name ("Dutch");
  - "skill" for a skill, tool or method, with skill set to a short name ("Figma", "Design systems", "User research");
  - "other" for anything else, such as domain experience.
  Leave the fields that don't apply null.
- asksForReferences: true only if the posting explicitly asks applicants to provide references; otherwise false.
- language: the language the posting is written in, as its English name.`;

/** NEW-3: title, company, role, location, work mode, salary, deadline, typed requirements and language. */
export const extractPosting: Task<{ posting: string; today?: Date }, Extracted> = async (provider, { posting, today = new Date() }, { signal }) => {
  const ask = () =>
    provider.complete({
      system: system(INSTRUCTIONS, `Today is ${localDate(today)}.`, UNTRUSTED_POSTING),
      messages: [{ role: "user", content: postingForPrompt(posting) }],
      schema: answerSchema,
      schemaName: "extracted_posting",
      // Reading, not writing: no creativity or long thought wanted.
      creativity: "FAITHFUL",
      effort: "low",
      signal,
    });
  let answer = await ask();
  // A small model sometimes answers with every detail null while listing requirements; one more look
  // usually finds them. The first answer stands when the second finds nothing either or fails.
  if (!answer.title && !answer.company && !answer.role) {
    const again = await ask().catch((error: unknown) => {
      if (signal?.aborted) throw error;
      return null;
    });
    if (again?.title || again?.company || again?.role) answer = again;
  }
  const role = answer.role?.trim() || null;
  const company = answer.company?.trim() || null;
  return {
    data: extractedSchema.parse({
      ...answer,
      role,
      company,
      title: answer.title?.trim() || (role && company ? `${role} · ${company}` : null),
      deadline: isoDate(answer.deadline),
      requirements: answer.requirements.filter((requirement) => requirement.text.trim()),
    }),
    promptVersion: EXTRACT_POSTING_VERSION,
  };
};

/** "2026-10-15" from whatever the model wrote, or null when it isn't a whole date. */
export function isoDate(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (iso) return z.iso.date().safeParse(value.trim()).success ? value.trim() : null;
  // Only dates with a year: "15 Oct" can't be placed safely.
  if (!/\b\d{4}\b/.test(value)) return null;
  const parsed = Date.parse(`${value} UTC`);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/** The calendar day on the server, YYYY-MM-DD. */
function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
