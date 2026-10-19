import "server-only";

import { z } from "zod";

import { EmailDirection } from "@/generated/prisma/enums";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { draftReply } from "@/lib/ai/tasks";
import { extractedOf } from "@/lib/application-data";
import { proposeSlots, workingHours } from "@/lib/google/availability";
import { formatSlot } from "@/lib/google/slots";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { defineJob } from "./runner";

/** The key of a reply being drafted, to find it again after a reload. */
export const replyJobKey = (emailId: string) => `reply:${emailId}`;

/**
 * Drafts the answer to an employer's mail (E15-4): from the profile, the
 * application and the thread, offering free times from the calendar when
 * they ask to meet. `slots` picks the times; empty asks the calendar.
 */
export const draftReplyJob = defineJob({
  type: "draft-reply",
  input: z.object({
    emailId: z.string().min(1),
    note: z.string().max(2000).default(""),
    /** ISO starts of the times to offer; null asks the calendar. */
    slots: z.array(z.iso.datetime({ offset: true })).nullable().default(null),
  }),
  result: z.object({ body: z.string(), gaps: z.array(z.string()), unverified: z.array(z.string()), slots: z.array(z.string()) }),
  async run({ emailId, note, slots: chosen }, { step, signal }) {
    const email = await prisma.emailMessage.findUniqueOrThrow({ where: { id: emailId }, include: { application: true } });
    const application = email.application;

    await step("Checking your calendar");
    // The user's zone, for the offered times and the email's date.
    const { timeZone } = await workingHours();
    let offered: string[] = [];
    let starts: string[] = [];
    if (email.kind === "INTERVIEW" && !email.confirmedAt) {
      const proposal = await proposeSlots().catch(() => ({ slots: [], timeZone, fromCalendar: false }));
      const minutes = proposal.slots[0] ? proposal.slots[0].end.getTime() - proposal.slots[0].start.getTime() : 45 * 60_000;
      const picked = chosen
        ? chosen.map((start) => ({ start: new Date(start), end: new Date(new Date(start).getTime() + minutes) }))
        : proposal.slots.slice(0, 3);
      offered = picked.map((slot) => `${formatSlot(slot, proposal.timeZone)} (${proposal.timeZone})`);
      starts = picked.map((slot) => slot.start.toISOString());
    }

    await step("Writing your answer");
    const thread = await prisma.emailMessage.findMany({
      where: { threadId: email.threadId, id: { not: email.id }, sentAt: { lt: email.sentAt } },
      orderBy: { sentAt: "asc" },
      take: 4,
      select: { direction: true, fromName: true, body: true },
    });
    const [provider, options, profile] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile()]);
    const { data, promptVersion } = await draftReply(
      provider,
      {
        profile,
        extracted: application ? extractedOf(application) : null,
        tone: application?.tone ?? "WARM",
        email: { from: [email.fromName, `<${email.fromAddress}>`].filter(Boolean).join(" "), subject: email.subject, body: email.body, sentAt: email.sentAt },
        timeZone,
        thread: thread.map((entry) => `${entry.direction === EmailDirection.OUTGOING ? "The candidate" : entry.fromName || "They"} wrote:\n${entry.body.slice(0, 2000)}`),
        slots: offered,
        note,
        posting: application?.postingText ?? "",
      },
      { ...options, language: null, signal },
    );
    await prisma.emailMessage.update({ where: { id: emailId }, data: { replyDraft: data.body, replyGaps: data.gaps, draftedWith: promptVersion } });
    return { ...data, slots: starts };
  },
});

export type DraftReplyResult = z.infer<typeof draftReplyJob.result>;
