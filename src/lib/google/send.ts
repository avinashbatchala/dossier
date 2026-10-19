import "server-only";

import { ApplicationStatus, DocumentKind, EmailDirection } from "@/generated/prisma/enums";
import { unitsSchema } from "@/lib/application-data";
import { emailAddresses, emailParts } from "@/lib/application-email";
import { resolveFileName } from "@/lib/file-name";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { applyStatusChange } from "@/lib/status-changes";

import { loadGoogleAccount } from "./account";
import { GoogleError } from "./errors";
import { sendMail } from "./gmail";
import type { Attachment } from "./mime";

// Sending through Gmail (E15-2): the application's email with its PDFs, and
// answers to employers in their thread. Each send is asked for by the user;
// nothing goes out on its own.

const PRINTED = [
  { kind: DocumentKind.RESUME, path: "resume" },
  { kind: DocumentKind.COVER_LETTER, path: "letter" },
] as const;

/** "Jane Doe <jane@gmail.com>", from the profile's name and the account. */
async function sender(address: string): Promise<string> {
  const name = (await loadProfileName()).trim().replace(/[<>"]/g, "");
  return name ? `${name} <${address}>` : address;
}

export type SentApplication = { threadId: string; eventId: string | null; attachments: string[] };

/**
 * Sends the application's email from the connected account, with the
 * tailored resume and cover letter attached, keeps the thread to watch for
 * replies, and moves a draft to Sent.
 */
export async function sendApplicationEmail(applicationId: string): Promise<SentApplication> {
  const account = await loadGoogleAccount();
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  const application = await prisma.application.findUnique({ where: { id: applicationId }, include: { documents: { select: { kind: true, units: true } } } });
  if (!application) throw new GoogleError("unavailable", "That application no longer exists.");

  const units = unitsSchema.safeParse(application.documents.find((document) => document.kind === DocumentKind.EMAIL)?.units);
  if (!units.success) throw new GoogleError("unavailable", "Write the email first.");
  const { to, subject, body } = emailParts(units.data);
  if (emailAddresses(to).length === 0) throw new GoogleError("unavailable", "Add who it's to first: the posting doesn't give an address.");
  if (!subject.trim() || !body.trim()) throw new GoogleError("unavailable", "The email needs a subject and a message.");

  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const attachments: Attachment[] = [];
  for (const { kind, path } of PRINTED) {
    if (!application.documents.some((document) => document.kind === kind)) continue;
    attachments.push({
      fileName: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: kind, date: new Date() }),
      contentType: "application/pdf",
      data: await renderPdf(`/print/${path}/${applicationId}`),
    });
  }

  const from = await sender(account.email);
  const sent = await sendMail({ from, to, subject, body, attachments });
  await prisma.$transaction([
    prisma.application.update({ where: { id: applicationId }, data: { emailThreadId: sent.threadId } }),
    prisma.emailMessage.upsert({
      where: { gmailId: sent.id },
      create: {
        gmailId: sent.id,
        threadId: sent.threadId,
        applicationId,
        direction: EmailDirection.OUTGOING,
        fromName: name.trim(),
        fromAddress: account.email.toLowerCase(),
        toAddress: to,
        subject,
        body,
        sentAt: new Date(),
        handledAt: new Date(),
      },
      update: {},
    }),
  ]);

  let eventId: string | null = null;
  if (application.status === ApplicationStatus.DRAFT) {
    const change = await applyStatusChange(prisma, applicationId, ApplicationStatus.SENT);
    if (change.outcome === "changed") eventId = change.event.id;
  }
  return { threadId: sent.threadId, eventId, attachments: attachments.map((file) => file.fileName) };
}

/** "Re: …", unless it already is. */
export const replySubject = (subject: string) => (/^\s*(re|aw|sv|antw)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`);

/** Sends the answer to an employer's mail in its thread, and marks the mail as answered. */
export async function sendReply(emailId: string, body: string): Promise<{ applicationId: string | null }> {
  const account = await loadGoogleAccount();
  if (!account) throw new GoogleError("not-connected", "Connect your Google account in Settings → Google first.");
  const email = await prisma.emailMessage.findUnique({ where: { id: emailId } });
  if (!email) throw new GoogleError("unavailable", "That email is no longer in Dossier.");
  if (!body.trim()) throw new GoogleError("unavailable", "Write the answer first.");
  if (/\[…\]|\[\.\.\.\]/.test(body)) throw new GoogleError("unavailable", "Fill in the parts marked […] first.");

  const to = email.fromName ? `${email.fromName.replace(/[<>"]/g, "")} <${email.fromAddress}>` : email.fromAddress;
  const subject = replySubject(email.subject);
  const sent = await sendMail(
    { from: await sender(account.email), to, subject, body, inReplyTo: email.messageId || undefined },
    { threadId: email.threadId },
  );
  await prisma.$transaction([
    prisma.emailMessage.update({ where: { id: emailId }, data: { handledAt: new Date(), replyDraft: "", replyGaps: [] } }),
    prisma.emailMessage.upsert({
      where: { gmailId: sent.id },
      create: {
        gmailId: sent.id,
        threadId: sent.threadId,
        applicationId: email.applicationId,
        direction: EmailDirection.OUTGOING,
        fromName: (await loadProfileName()).trim(),
        fromAddress: account.email.toLowerCase(),
        toAddress: to,
        subject,
        body,
        sentAt: new Date(),
        handledAt: new Date(),
      },
      update: {},
    }),
  ]);
  return { applicationId: email.applicationId };
}
