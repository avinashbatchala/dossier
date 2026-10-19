"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { ApplicationStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { isAiConfigured } from "@/lib/ai/config";
import { draftReplyJob, replyJobKey } from "@/lib/jobs/draft-reply";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { applySecretChange, GOOGLE_CLIENT_SECRET } from "@/lib/secrets";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { statusInfo } from "@/lib/status";
import { applyStatusChange } from "@/lib/status-changes";

import { disconnectGoogle, googleConnection } from "./account";
import { proposeSlots, scheduleInterview } from "./availability";
import { GoogleError } from "./errors";
import { loadGoogleClientConfig } from "./oauth";
import { sendApplicationEmail, sendReply } from "./send";
import { formatSlot } from "./slots";
import { checkInboxNow, readReply } from "./sync";

// Gmail and Calendar from the app (E15). Google's failures reach the user as
// their own message; every send is a separate, confirmed request.

const refreshEverything = () => revalidatePath("/", "layout");

/** Runs `work`, turning a GoogleError into a message for the user. */
async function google<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GoogleError) throw new ActionError(error.message);
    throw error;
  }
}

/** Settings → Google: what each switch and field saves. */
export const saveGoogleSettings = action(
  z.strictObject({
    gmailRead: z.boolean().optional(),
    gmailScope: z.enum(["known", "all"]).optional(),
    gmailInterval: z.number().int().min(5).max(120).optional(),
    calendarAvailability: z.boolean().optional(),
    calendarEvents: z.boolean().optional(),
    calendarId: z.string().trim().min(1).max(300).optional(),
    workDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
    workStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    workEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    workTimeZone: z
      .string()
      .trim()
      .max(100)
      .refine((zone) => {
        if (!zone) return true;
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "That isn't a time zone.")
      .optional(),
    slotMinutes: z.number().int().min(15).max(240).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
  }),
  async ({ workTimeZone, workDays, ...changes }) => {
    if (changes.workStart && changes.workEnd && changes.workStart >= changes.workEnd) throw new ActionError("The working day has to end after it starts.");
    await saveSettings({
      ...changes,
      ...(workDays ? { workDays: [...new Set(workDays)].sort() } : {}),
      ...(workTimeZone === undefined ? {} : { workTimeZone: workTimeZone || null }),
    });
    return null;
  },
);

/** What Settings → Google shows of the OAuth client: the ID, and only whether a secret is there. */
const clientView = async () => {
  const { id, idState, secretState } = await loadGoogleClientConfig();
  return { id, idState, secretState };
};

/**
 * Saves the OAuth client in Settings → Google: the ID as typed (empty
 * removes it), the secret encrypted, or removed. The secret never comes
 * back to the browser. A different client ID can't use the old grant, so
 * changing it disconnects the account.
 */
export const saveGoogleClient = action(
  z.strictObject({
    id: z.string().trim().max(300).optional(),
    secret: z
      .discriminatedUnion("action", [z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(500) }), z.object({ action: z.literal("clear") })])
      .optional(),
  }),
  async ({ id, secret }) => {
    const current = await loadSettings();
    const before = await loadGoogleClientConfig();
    await saveSettings({
      ...(id === undefined ? {} : { googleClientId: id || null }),
      ...(secret === undefined ? {} : { googleClientSecretEnc: applySecretChange(GOOGLE_CLIENT_SECRET, current.googleClientSecretEnc, secret) }),
    });
    // Google's grant belongs to the client ID; a new secret for the same client keeps it.
    if (before.id && before.id !== (await loadGoogleClientConfig()).id) await disconnectGoogle().catch(() => {});
    revalidatePath("/settings");
    return clientView();
  },
);

/** "Disconnect": revokes Dossier's access at Google. Mail already in Dossier stays. */
export const disconnectGoogleAccount = action(z.object({}), async (_, { toast }) => {
  await google(disconnectGoogle);
  revalidatePath("/settings");
  toast("Disconnected from Google.");
  return null;
});

/** "Check now" in the inbox and Settings. */
export const checkInbox = action(z.object({}), async (_, { toast }) => {
  const result = await google(checkInboxNow);
  refreshEverything();
  if (!result) toast("Already checking. It'll be done in a moment.");
  else toast(result.kept === 0 ? "Nothing new about your applications." : `${result.kept} new ${result.kept === 1 ? "email" : "emails"} about your applications.`);
  return result;
});

/** "Send with Gmail" on the Email tab, after the confirmation. */
export const sendWithGmail = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const sent = await google(() => sendApplicationEmail(id));
  refreshEverything();
  toast(sent.eventId ? `Sent. ${statusInfo(ApplicationStatus.SENT).toast}` : "Sent. I'll watch for replies.");
  return { eventId: sent.eventId };
});

/** Drafts (or redrafts) the answer to an email in the background. */
export const startDraftingReply = action(
  z.object({ emailId: z.string().min(1), note: z.string().max(2000).default(""), slots: z.array(z.iso.datetime({ offset: true })).max(8).nullable().default(null) }),
  async ({ emailId, note, slots }) => {
    const email = await prisma.emailMessage.findUnique({ where: { id: emailId }, select: { applicationId: true } });
    if (!email) throw new ActionError("That email is no longer in Dossier.");
    if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
    const [running] = await findUnfinishedJobs(replyJobKey(emailId));
    // Linked to its application, so deleting that deletes the job too.
    return running?.id ?? startJob(draftReplyJob, { emailId, note, slots }, { key: replyJobKey(emailId), applicationId: email.applicationId ?? undefined });
  },
);

/** Saves the answer as edited by hand. */
export const saveReplyDraft = action(z.object({ emailId: z.string().min(1), body: z.string().max(20_000) }), async ({ emailId, body }) => {
  const { count } = await prisma.emailMessage.updateMany({ where: { id: emailId }, data: { replyDraft: body } });
  if (count === 0) throw new ActionError("That email is no longer in Dossier.");
  return null;
});

/** "Send" on a drafted answer, after the confirmation. */
export const sendReplyEmail = action(z.object({ emailId: z.string().min(1), body: z.string().min(1).max(20_000) }), async ({ emailId, body }, { toast }) => {
  await google(() => sendReply(emailId, body));
  refreshEverything();
  toast("Answer sent.");
  return null;
});

/** "No answer needed": takes it off the list. */
export const markHandled = action(z.object({ emailId: z.string().min(1), handled: z.boolean() }), async ({ emailId, handled }) => {
  await prisma.emailMessage.updateMany({ where: { id: emailId }, data: { handledAt: handled ? new Date() : null } });
  refreshEverything();
  return null;
});

/** Links a mail to an application ("Needs a look"), with the rest of its thread. Null unlinks. */
export const linkEmail = action(z.object({ emailId: z.string().min(1), applicationId: z.string().min(1).nullable() }), async ({ emailId, applicationId }, { toast }) => {
  const email = await prisma.emailMessage.findUnique({ where: { id: emailId }, select: { threadId: true } });
  if (!email) throw new ActionError("That email is no longer in Dossier.");
  if (applicationId && !(await prisma.application.count({ where: { id: applicationId } }))) throw new ActionError("That application no longer exists.");
  // Mail dismissed before has nothing left to show, so it stays dismissed.
  await prisma.emailMessage.updateMany({ where: { threadId: email.threadId, dismissedAt: null }, data: { applicationId } });
  refreshEverything();
  toast(applicationId ? "Linked. Replies in this thread will go there too." : "Unlinked.");
  return null;
});

/**
 * "Not job-related": hidden from the inbox, and not fetched again. Only the
 * Gmail ids and the date stay, for the inbox check to skip it: the text,
 * who it's from and to, and what the AI read go.
 */
export const dismissEmail = action(z.object({ emailId: z.string().min(1) }), async ({ emailId }, { toast }) => {
  await prisma.emailMessage.updateMany({
    where: { id: emailId },
    data: {
      dismissedAt: new Date(),
      applicationId: null,
      fromName: "",
      fromAddress: "",
      toAddress: "",
      subject: "",
      messageId: "",
      body: "",
      kind: null,
      summary: "",
      questions: Prisma.DbNull,
      suggestedStatus: null,
      confirmedAt: null,
      classifiedWith: null,
      replyDraft: "",
      replyGaps: Prisma.DbNull,
      draftedWith: null,
    },
  });
  refreshEverything();
  toast("Hidden from your inbox.");
  return null;
});

/** "Read again": the AI reads a mail it couldn't before. */
export const rereadEmail = action(z.object({ emailId: z.string().min(1) }), async ({ emailId }) => {
  if (!(await isAiConfigured())) throw new ActionError("That needs an AI provider. Choose one in Settings → AI provider.");
  await readReply(emailId);
  refreshEverything();
  return null;
});

/** Takes up a reply's suggested status (or turns it down), through the status module. */
export const applySuggestedStatus = action(z.object({ emailId: z.string().min(1), accept: z.boolean() }), async ({ emailId, accept }, { toast }) => {
  const email = await prisma.emailMessage.findUnique({ where: { id: emailId }, select: { applicationId: true, suggestedStatus: true } });
  if (!email) throw new ActionError("That email is no longer in Dossier.");
  await prisma.emailMessage.update({ where: { id: emailId }, data: { suggestedStatus: null } });
  if (!accept || !email.applicationId || !email.suggestedStatus) return { eventId: null };
  const result = await applyStatusChange(prisma, email.applicationId, email.suggestedStatus);
  refreshEverything();
  if (result.outcome !== "changed") return { eventId: null };
  toast(statusInfo(email.suggestedStatus).toast);
  return { eventId: result.event.id };
});

/** Free times to offer, for the reply's slot picker. */
export const loadFreeSlots = action(z.object({}), async () => {
  const connection = await googleConnection();
  if (connection.status !== "connected" || !connection.canUseCalendar) return { slots: [], timeZone: null, fromCalendar: false };
  const { slots, timeZone, fromCalendar } = await google(() => proposeSlots());
  return { slots: slots.map((slot) => ({ start: slot.start.toISOString(), label: formatSlot(slot, timeZone) })), timeZone, fromCalendar };
});

/** "Add to calendar" for an agreed time: the dashboard's next interview, the calendar, and Interview. */
export const confirmInterview = action(
  z.object({ emailId: z.string().min(1), start: z.iso.datetime({ offset: true }), moveToInterview: z.boolean() }),
  async ({ emailId, start, moveToInterview }, { toast }) => {
    const email = await prisma.emailMessage.findUnique({ where: { id: emailId }, select: { applicationId: true } });
    if (!email?.applicationId) throw new ActionError("Link this email to an application first.");
    const { eventLink } = await google(() => scheduleInterview(email.applicationId!, new Date(start)));
    let eventId: string | null = null;
    if (moveToInterview) {
      const result = await applyStatusChange(prisma, email.applicationId, ApplicationStatus.INTERVIEW);
      if (result.outcome === "changed") eventId = result.event.id;
    }
    await prisma.emailMessage.update({ where: { id: emailId }, data: { confirmedAt: null, suggestedStatus: null } });
    refreshEverything();
    toast(eventLink ? "Interview added to your calendar and dashboard." : "Interview added to your dashboard.");
    return { eventLink, eventId };
  },
);
