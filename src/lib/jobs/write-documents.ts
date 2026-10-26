import "server-only";

import { z } from "zod";

import { Tone } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorResume, writeCoverLetter } from "@/lib/ai/tasks";
import { extractedSchema, matchSchema, unitsSchema } from "@/lib/application-data";
import { loadProfile } from "@/lib/profile-data";

import { WRITE_DOCUMENTS_STEPS } from "./application-steps";
import { defineJob } from "./runner";

/**
 * Writes the tailored resume and cover letter (E7-6, NEW-7). Saves nothing:
 * the application is created from the result in one transaction afterwards,
 * so leaving midway leaves nothing behind.
 */
export const writeDocumentsJob = defineJob({
  type: "write-documents",
  input: z.object({
    /** The job that read the posting; its result and input are the source of truth. */
    readJobId: z.string().min(1),
    posting: z.string().min(1),
    /** What was read, with the user's corrections (company, role…) for the prompts. */
    extracted: extractedSchema,
    /** The match as shown, including skills added to the profile since. */
    match: matchSchema,
    tone: z.enum(Tone),
    note: z.string().max(2000),
  }),
  result: z.object({ resume: unitsSchema, resumeWith: z.string(), letter: unitsSchema, letterWith: z.string() }),
  async run({ posting, extracted, match, tone, note }, { step, signal }) {
    await step(WRITE_DOCUMENTS_STEPS[0]);
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
    // "Anything I should know?" is the application's first fact (APP-15).
    const facts = note.trim() ? [note.trim()] : [];
    const resume = await tailorResume(provider, { profile, extracted, match, facts, posting }, { ...options, signal });

    await step(WRITE_DOCUMENTS_STEPS[1]);
    const letter = await writeCoverLetter(provider, { profile, extracted, match, tone, facts, posting }, { ...options, signal });

    return { resume: resume.data, resumeWith: resume.promptVersion, letter: letter.data, letterWith: letter.promptVersion };
  },
});

export type WriteDocumentsInput = z.infer<typeof writeDocumentsJob.input>;
export type WriteDocumentsResult = z.infer<typeof writeDocumentsJob.result>;
