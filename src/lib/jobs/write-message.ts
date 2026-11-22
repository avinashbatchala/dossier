import "server-only";

import { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { writeMessage } from "@/lib/ai/tasks";
import { extractedOf, unitsSchema } from "@/lib/application-data";
import { emailParts } from "@/lib/application-email";
import { formatCalendarDate, formatDay } from "@/lib/dates";
import { profileOfApplication } from "@/lib/frozen-copy";
import { MESSAGE_KINDS, messageDraftSchema } from "@/lib/message-draft";
import { prisma } from "@/lib/prisma";
import { loadFactTexts } from "@/lib/profile-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { defineJob } from "./runner";

/** The key of drafting an application's message, to find it again after a reload. */
export const messageJobKey = (applicationId: string) => `message:${applicationId}`;

/**
 * Drafts a follow-up or an answer to the offer (E30-7, E30-8) and keeps it
 * on the application, over any draft before it. Only ever on a click, and
 * never sent without the user.
 */
export const writeMessageJob = defineJob({
  type: "write-message",
  input: z.object({ applicationId: z.string().min(1), kind: z.enum(MESSAGE_KINDS) }),
  result: messageDraftSchema,
  async run({ applicationId, kind }, { step, signal }) {
    await step(kind === "follow-up" ? "Drafting a follow-up" : "Drafting your answer");
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { offer: true, documents: { where: { kind: DocumentKind.EMAIL }, select: { units: true } } },
    });
    const [provider, options, profile, facts, timeZone] = await Promise.all([
      getAiProvider(),
      loadTaskOptions(),
      profileOfApplication(application.frozen, application.profileId),
      loadFactTexts(applicationId),
      lastKnownTimeZone(),
    ]);
    const { offer } = application;
    const { data, promptVersion } = await writeMessage(
      provider,
      {
        kind,
        name: profile.basics.name,
        profile,
        extracted: extractedOf(application),
        sent: application.sentAt ? formatDay(application.sentAt, timeZone) : null,
        offer: kind === "follow-up" ? null : { salary: offer?.salary ?? "", startDate: offer?.startDate ? formatCalendarDate(offer.startDate) : null, postedSalary: application.salary },
        facts,
      },
      { ...options, language: application.language || options.language, signal },
    );
    // To whoever the application's email went to, when there is one.
    const units = unitsSchema.safeParse(application.documents[0]?.units);
    const draft = { kind, to: units.success ? emailParts(units.data).to : "", subject: data.subject, body: data.body, writtenWith: promptVersion, at: new Date().toISOString() };
    await prisma.application.update({ where: { id: applicationId }, data: { messageDraft: draft } });
    return draft;
  },
});
