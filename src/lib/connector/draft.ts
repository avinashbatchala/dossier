import "server-only";

import { z } from "zod";

import { createApplicationFromDocuments, type ApplicationDetails } from "@/lib/application-create";
import type { Extracted } from "@/lib/application-data";
import { readPostingJob } from "@/lib/jobs/read-posting";
import { defineJob } from "@/lib/jobs/runner";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { loadSettings } from "@/lib/settings-data";

// A draft application asked for from Claude chat (#221, draft_application),
// written by Dossier's own AI model: read the posting, write the resume and
// cover letter, and create a Draft application, the way New application does
// it, in one go. Nothing is sent.

/** The application's details from what was read, as New application fills them in. */
function detailsFrom(extracted: Extracted): ApplicationDetails {
  return {
    title: extracted.title ?? [extracted.role, extracted.company].filter(Boolean).join(" · "),
    company: extracted.company ?? "",
    role: extracted.role ?? "",
    location: extracted.location ?? "",
    mode: extracted.mode ?? "",
    salary: extracted.salary ?? "",
    deadline: extracted.deadline ?? "",
  };
}

export const connectorDraftJob = defineJob({
  type: "connector-draft",
  input: z.object({
    posting: z.string().trim().min(1).max(100_000),
    /** A checked http(s) link, or "". */
    postingUrl: z.string().max(2000),
    note: z.string().max(2000),
    /** The posting from Find jobs it came from, so it shows as applied for. */
    postingId: z.string().nullable(),
  }),
  result: z.object({ applicationId: z.string().min(1) }),
  async run({ posting, postingUrl, note, postingId }, context) {
    const reading = await readPostingJob.run({ posting }, context);
    const settings = await loadSettings();
    const documents = await writeDocumentsJob.run(
      { readJobId: context.id, posting, extracted: reading.extracted, match: reading.match, tone: settings.defaultTone, note },
      context,
    );
    const applicationId = await createApplicationFromDocuments({
      reading: { posting, ...reading },
      documents,
      match: reading.match,
      details: detailsFrom(reading.extracted),
      postingUrl,
      tone: settings.defaultTone,
      note,
      // This job claims it, as New application's write job does, so a retry can't make two.
      claim: { kind: "manual", writeJobId: context.id, readJobId: context.id, postingId },
    });
    return { applicationId };
  },
});
