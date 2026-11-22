import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { lineText } from "@/lib/changed-lines";

// Schemas for the JSON columns of Application, Document and ChatMessage
// (prisma/schema.prisma). The AI tasks (src/lib/ai/tasks) produce these
// shapes. Parse a column with `schema.parse(row.column)` when reading it.

/**
 * A part of a tailored document that can be edited, regenerated or refined
 * on its own (APP-4). Ids are stable: "summary", "skills", "languages",
 * "experience:<experience id>", "education:<education id>" in a resume, and
 * "paragraph:1", "paragraph:2"… and "sign-off" in a cover letter.
 */
export const unitSchema = z.object({
  id: z.string().min(1),
  /** Shown on the unit's toolbar and the chat target, e.g. "Summary" or "Northwind Logistics role". */
  label: z.string(),
  text: z.string(),
  /**
   * Names, numbers or credentials the fact guard (E6-6) couldn't find in the
   * profile or the posting, shown as "check this" (E8-3). Absent when fine.
   */
  unverified: z.array(z.string()).optional(),
  /**
   * Which of the posting's requirements each line serves (E30-4), from the
   * writing: a line as it reads on the page, and the requirements' texts.
   * A line edited since no longer matches; documents from before have none.
   */
  serves: z.array(z.object({ line: z.string(), requirements: z.array(z.string()) })).optional(),
});
export type Unit = z.infer<typeof unitSchema>;

/** The cover letter's closing line ("Warm regards,"), kept as a unit so it can be edited. */
export const SIGN_OFF_UNIT = "sign-off";

/** Document.units: the document's units in reading order. */
export const unitsSchema = z
  .array(unitSchema)
  .refine((units) => new Set(units.map((unit) => unit.id)).size === units.length, {
    error: "Unit ids must be unique.",
  });

/**
 * One thing the posting asks for, typed so matching can be checked in code
 * (E6-5): a skill, an amount of experience, a spoken language or anything else.
 */
export const requirementSchema = z.object({
  /** In the posting's words, shortened, e.g. "5+ years of product design". */
  text: z.string(),
  kind: z.enum(["skill", "years", "language", "other"]),
  /** For a skill: its short name, e.g. "Figma". */
  skill: z.string().nullable(),
  /** For an amount of experience: the years asked for. */
  years: z.number().nullable(),
  /** For a spoken language: its English name, e.g. "Dutch". */
  language: z.string().nullable(),
});
export type Requirement = z.infer<typeof requirementSchema>;

/** Application.extracted: what the AI read from the posting (NEW-3). Missing fields are null. */
export const extractedSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  location: z.string().nullable(),
  mode: z.string().nullable(),
  salary: z.string().nullable(),
  /** "2026-10-15" */
  deadline: z.iso.date().nullable(),
  requirements: z.array(requirementSchema),
  /** Whether the posting asks for references (SET-9: include them only then). */
  asksForReferences: z.boolean(),
  /** The posting's language, e.g. "English", for "Write documents in: the posting's language". */
  language: z.string().nullable(),
});
export type Extracted = z.infer<typeof extractedSchema>;

/**
 * What was read from an application's posting, for a prompt. Rows from
 * before the current schema fall back to the application's own details.
 */
export function extractedOf(application: {
  extracted: unknown;
  title: string;
  company: string;
  role: string;
  location: string;
  mode: string;
  salary: string;
  language: string;
}): Extracted {
  const parsed = extractedSchema.safeParse(application.extracted);
  if (parsed.success) return parsed.data;
  const orNull = (value: string) => value.trim() || null;
  return {
    title: orNull(application.title),
    company: orNull(application.company),
    role: orNull(application.role),
    location: orNull(application.location),
    mode: orNull(application.mode),
    salary: orNull(application.salary),
    deadline: null,
    requirements: [],
    asksForReferences: false,
    language: orNull(application.language),
  };
}

/**
 * How a requirement matches the profile (NEW-4): covered (the skill is used in
 * a role), partial (the skill is in the profile but not attached to a role)
 * or gap (not in the profile).
 */
const matchResults = ["covered", "partial", "gap"] as const;
export type MatchResult = (typeof matchResults)[number];

const matchItemSchema = z.object({
  requirement: z.string(),
  result: z.enum(matchResults),
  /** The profile skill or language the requirement maps to, if any. */
  skill: z.string().nullable(),
  /** The roles where that skill was used. */
  experienceIds: z.array(z.string()),
  /** A short explanation, e.g. "Nothing in your profile for this yet". Older matches may promise the letter addresses it. */
  note: z.string().nullable(),
  /** From the scoring engine (E25-7): a must-have, or a nice-to-have. Missing in matches from before. */
  mustHave: z.boolean().optional(),
  /** From the scoring engine: the skill "+ Add to profile" adds for a missing one, or null for none. Missing in matches from before, which use the extracted requirement's. */
  addable: z.string().nullable().optional(),
});

/** Application.match */
export const matchSchema = z.object({ items: z.array(matchItemSchema) });
export type Match = z.infer<typeof matchSchema>;

/**
 * How you match from the scoring engine's requirements (E25-7): each covered
 * with what covers it, or missing, a must-have or a nice-to-have.
 */
export function matchFromRequirements(requirements: readonly { text: string; mustHave: boolean; covered: boolean; evidence: string | null; skill?: string | null }[]): Match {
  return {
    items: requirements.map((requirement) => ({
      requirement: requirement.text,
      result: requirement.covered ? "covered" : "gap",
      skill: null,
      experienceIds: [],
      note: requirement.covered ? requirement.evidence : null,
      mustHave: requirement.mustHave,
      addable: requirement.covered ? null : (requirement.skill ?? null),
    })),
  };
}

/**
 * The skill "+ Add to profile" adds for a requirement (NEW-5): the one the
 * scoring engine named (E25-7), or, in a match from before, the extracted
 * requirement's at the same place. Null when there's none to add. The
 * button and the server action both ask this, so they never disagree (#439).
 */
export function addableSkill(item: Match["items"][number], requirement: Requirement | undefined): string | null {
  if (item.addable !== undefined) return item.addable;
  return requirement?.kind === "skill" ? requirement.skill : null;
}

/** A gap after its skill was added to the profile (NEW-5): in the profile, not yet used in a role. */
export function withSkillAdded(item: Match["items"][number], skill: string): Match["items"][number] {
  return { ...item, result: "partial", skill, note: "In your skills, but not linked to a role yet" };
}

/** "5/7 match": requirements that are covered or partly covered, out of all of them. */
export function matchScore(match: Match): { hit: number; total: number } {
  return {
    hit: match.items.filter((item) => item.result !== "gap").length,
    total: match.items.length,
  };
}

/**
 * The words beside the coverage ring (E30-1): "Strong fit" from how many
 * requirements are covered, never a score out of 100. A must-have that's
 * missing keeps it from "Strong fit".
 */
export function coverageBand(match: Match): string {
  const { hit, total } = matchScore(match);
  if (total === 0) return "Not checked yet";
  const share = hit / total;
  const mustHaveMissing = match.items.some((item) => item.result === "gap" && item.mustHave === true);
  if (share >= 0.7 && !mustHaveMissing) return "Strong fit";
  if (share >= 0.5) return "Good fit";
  if (share >= 0.3) return "Partial fit";
  return "Long shot";
}

/** One unit change made from the chat, with the text it replaced so it can be undone (APP-8). */
const unitEditSchema = z.object({
  document: z.enum(DocumentKind),
  unitId: z.string().min(1),
  text: z.string(),
  previousText: z.string(),
  /** What the fact guard couldn't back in the new text (E6-6). */
  unverified: z.array(z.string()).optional(),
  /** The fact guard's hints on the text it replaced, which Undo brings back. */
  previousUnverified: z.array(z.string()).optional(),
  /** The requirements the new text serves (E30-12), by their text. */
  serves: z.array(z.string()).optional(),
});

/**
 * A unit's `serves` after an edit (E30-12): its lines still there keep
 * theirs, and the new lines serve what the edit says.
 */
export function servesAfterEdit(unit: Unit, text: string, serves: readonly string[] | undefined): Unit["serves"] {
  const lines = text.split("\n").map((line) => lineText(line)).filter(Boolean);
  const before = new Set(unit.text.split("\n").map((line) => lineText(line)));
  const kept = (unit.serves ?? []).filter((entry) => lines.includes(entry.line));
  const added = serves && serves.length > 0 ? lines.filter((line) => !before.has(line)).map((line) => ({ line, requirements: [...serves] })) : [];
  const all = [...kept, ...added];
  return all.length > 0 ? all : undefined;
}

/**
 * Document.trimmed (E10-10): what was left out of a tailored resume to fit
 * its page limit, or by hand with "Leave out" (#217), so it can be put back.
 * A whole part goes back where it was; bullets go back at the end of their role.
 */
export const trimmedSchema = z.array(
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("unit"),
      unit: unitSchema,
      index: z.number().int().min(0),
      /** Left out with "Leave out", not to fit the page limit. */
      byHand: z.literal(true).optional(),
    }),
    z.object({ kind: z.literal("bullets"), unitId: z.string().min(1), label: z.string(), lines: z.array(z.string()).min(1) }),
  ]),
);
export type Trimmed = z.infer<typeof trimmedSchema>;

/** ChatMessage.edits */
export const editsSchema = z.array(unitEditSchema);
export type UnitEdit = z.infer<typeof unitEditSchema>;
