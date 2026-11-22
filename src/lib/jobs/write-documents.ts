import "server-only";

import { z } from "zod";

import { Tone } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { tailorResume, writeCoverLetter } from "@/lib/ai/tasks";
import { extractedSchema, matchSchema, unitsSchema } from "@/lib/application-data";
import { loadProfile } from "@/lib/profile-data";
import { withoutSectionsOff } from "@/lib/resume-sections";
import { DOCUMENTS_TO_WRITE } from "@/lib/settings";
import { loadProfileSettings } from "@/lib/profiles";

import { WRITE_DOCUMENTS_STEPS } from "./application-steps";
import { defineJob } from "./runner";

/**
 * Writes the tailored resume and cover letter (E7-6, NEW-7), or only the one
 * asked for (#367): one that isn't written comes back empty, with no
 * `…With`, and the application is created without it. Saves nothing: the
 * application is created from the result in one transaction afterwards, so
 * leaving midway leaves nothing behind.
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
    /** Which documents to write (#367); the job agent and the connector write both. */
    write: z.enum(DOCUMENTS_TO_WRITE).default("both"),
    /** The profile it's tailored from (E24-6); the first when it's missing. */
    profileId: z.string().min(1).optional(),
  }),
  result: z.object({ resume: unitsSchema, resumeWith: z.string(), letter: unitsSchema, letterWith: z.string() }),
  async run({ posting, extracted, match, tone, note, write, profileId }, { step, signal }) {
    await step(write === "letter" ? WRITE_DOCUMENTS_STEPS[1] : WRITE_DOCUMENTS_STEPS[0]);
    const [provider, options, fullProfile, settings] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(profileId), loadProfileSettings(profileId)]);
    // A section that's off on the base resume isn't written about (#297).
    const profile = withoutSectionsOff(fullProfile, settings.resumeSections);
    // "Anything I should know?" is the application's first fact (APP-15).
    const facts = note.trim() ? [note.trim()] : [];
    const skipped = { data: [], promptVersion: "" };
    // Skills in the user's own order once they set one (public issue 62).
    const resume =
      write === "letter"
        ? skipped
        : await tailorResume(provider, { profile, extracted, match, facts, posting, keepSkillOrder: settings.skillOrder === "manual" }, { ...options, signal });

    if (write === "both") await step(WRITE_DOCUMENTS_STEPS[1]);
    const letter = write === "resume" ? skipped : await writeCoverLetter(provider, { profile, extracted, match, tone, facts, posting }, { ...options, signal });

    return { resume: resume.data, resumeWith: resume.promptVersion, letter: letter.data, letterWith: letter.promptVersion };
  },
});

export type WriteDocumentsResult = z.infer<typeof writeDocumentsJob.result>;
