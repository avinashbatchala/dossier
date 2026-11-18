"use client";

import { FileText } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import type { UnitRenderer } from "@/components/documents/document-page";
import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import type { Unit } from "@/lib/application-data";
import { emailParts, mailtoHref } from "@/lib/application-email";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";

import { SendWithGmail, type GmailSender } from "./send-with-gmail";
import { aboutWords } from "./tabs";

/** The PDFs to attach, by their file names; null when the application doesn't have one. */
export type Attachments = { resume: string | null; letter: string | null };

/**
 * The Email tab: the email to send the application with, to whoever the
 * posting says to send it to. Each part copies on its own for a mail app's
 * fields, or the whole email opens in the mail app, and the resume and cover
 * letter it mentions download right below it. Its parts are edited,
 * regenerated and refined like the documents' (`renderUnit`). Before it's
 * written, the tab offers to write it.
 */
export function EmailTab({
  applicationId,
  units,
  renderUnit,
  history,
  hint,
  notice,
  writing,
  onWrite,
  attachments,
  gmail,
  markAsSent,
  before,
}: {
  applicationId: string;
  /** The email's units; null until it's written. */
  units: Unit[] | null;
  renderUnit: UnitRenderer;
  /** The History button. */
  history: ReactNode;
  /** How to change it, while the current version is shown. */
  hint?: string;
  /** Above the email, e.g. the banner over an earlier version. */
  notice?: ReactNode;
  /** It's being written or rewritten. */
  writing: boolean;
  /** "Write the email" and "Rewrite". */
  onWrite: () => void;
  attachments: Attachments;
  /** Sending with Gmail (E15-2): who it sends from, and whether it went out that way before. */
  gmail?: { sender: GmailSender; sentBefore: boolean };
  /** "Mark as sent" while it's a draft (E30-2): for an application sent some other way. */
  markAsSent?: ReactNode;
  /** Above it, e.g. a follow-up drafted on a click (E30-8). */
  before?: ReactNode;
}) {
  if (!units) {
    return (
      <div className="flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-[var(--composer-space,4rem)]">
        {before}
        <div className="flex w-full max-w-[560px] flex-col items-start gap-3 rounded-panel border border-line-card bg-card px-7 py-7">
          <h2 className="font-serif text-section">An email to send it with</h2>
          <p className="text-sm text-muted">
            I&apos;ll write a short email to go with your resume and cover letter, to whoever the posting says to send applications
            to. Copy it into your mail app or open it there, and attach the PDFs.
          </p>
          <Button className="mt-1" aria-disabled={writing || undefined} onClick={() => !writing && onWrite()}>
            {writing ? "Writing the email…" : "Write the email"}
          </Button>
        </div>
        {markAsSent && (
          <div className="mt-4 flex w-full max-w-[560px] flex-wrap items-center justify-between gap-3 text-meta text-muted">
            Sent it another way, such as on their site?
            {markAsSent}
          </div>
        )}
      </div>
    );
  }

  const { to, subject, body } = emailParts(units);
  const copy = async (text: string, what: string) =>
    toast((await copyText(text)) ? `Copied the ${what}.` : "That didn't copy. Select the text and copy it yourself.");

  const fromGmail = gmail?.sender.from ?? null;
  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-[var(--composer-space,4rem)]">
      {before}
      <div className="flex w-full max-w-[820px] flex-wrap items-center justify-between gap-x-3 gap-y-1 text-meta text-muted">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[13.5px] font-medium text-ink">Email to send with it</span>
          <span>{aboutWords([body])}</span>
          {history}
        </span>
        {hint && <span>{hint}</span>}
      </div>
      {notice && <div className="w-full max-w-[820px]">{notice}</div>}

      {/* One card (E30-13, design 4b): who it's to and from, the subject, the message, the PDFs and how to send it. */}
      <article
        aria-label="Email"
        aria-busy={writing || undefined}
        // The parts' highlight and toolbar are measured in page units, which are pixels here.
        style={{ "--u": "1px" } as CSSProperties}
        className={cn("w-full max-w-[820px] rounded-panel border border-line-card bg-card motion-safe:transition-opacity", writing && "opacity-50")}
      >
        <Field label="To" note={to ? "From the posting" : undefined} onCopy={to ? () => void copy(to, "recipient") : undefined}>
          {renderUnit({
            id: "to",
            children: to || <span className="text-muted">The posting doesn&apos;t give an address. Edit to add one.</span>,
          })}
        </Field>
        {fromGmail && (
          <Field label="From" note="Gmail connected">
            {fromGmail}
          </Field>
        )}
        <Field label="Subject" onCopy={subject ? () => void copy(subject, "subject") : undefined}>
          {renderUnit({ id: "subject", children: subject })}
        </Field>
        <div className="px-7 pt-6 pb-7">
          {renderUnit({ id: "body", className: "text-field leading-[1.6] break-words whitespace-pre-wrap", children: body })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line px-7 py-4">
          {attachments.resume && <Attachment name={attachments.resume} href={`/api/pdf?doc=resume&application=${applicationId}`} what="tailored resume" />}
          {attachments.letter && <Attachment name={attachments.letter} href={`/api/pdf?doc=letter&application=${applicationId}`} what="cover letter" />}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant={fromGmail ? "text" : "primary"} size="sm" onClick={() => void copy(body, "message")}>
              Copy <span className="sr-only">message</span>
            </Button>
            {/* Mail apps can't take attachments from a link: the PDFs are attached by hand. */}
            <a href={mailtoHref({ to, subject, body })} className={buttonClassName(fromGmail ? "text" : "secondary", "sm")}>
              Open in mail app
            </a>
            {gmail && (
              <SendWithGmail
                applicationId={applicationId}
                sender={gmail.sender}
                to={to}
                subject={subject}
                attachments={[attachments.resume, attachments.letter].filter((name): name is string => name !== null)}
                sentBefore={gmail.sentBefore}
              />
            )}
          </div>
        </div>
      </article>

      <div className="flex w-full max-w-[820px] flex-wrap items-center gap-3">
        {markAsSent}
        <Button variant="text" className="ml-auto" aria-disabled={writing || undefined} onClick={() => !writing && onWrite()}>
          {writing ? "Writing it again…" : "Write it again"}
        </Button>
      </div>
    </div>
  );
}

/** A header line of the email, "To", "From" or "Subject", with where it comes from and its Copy button. */
function Field({ label, note, onCopy, children }: { label: string; note?: string; onCopy?: () => void; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 border-b border-line px-7 py-3.5">
      <span className="w-14 shrink-0 text-meta text-muted">{label}</span>
      <div className="min-w-0 flex-1 text-field break-words">{children}</div>
      {note && <span className="shrink-0 text-[12px] text-muted">{note}</span>}
      {onCopy && (
        <Button variant="text" size="sm" className="py-0!" aria-label={`Copy the ${label === "To" ? "recipient" : label.toLowerCase()}`} onClick={onCopy}>
          Copy
        </Button>
      )}
    </div>
  );
}

/** A PDF to attach, as a chip that downloads it. */
function Attachment({ name, href, what }: { name: string; href: string; what: string }) {
  return (
    <DownloadPdfButton variant="secondary" size="sm" href={href} progress={`Rendering your ${what} as a PDF…`} className="max-w-[260px] gap-2 font-normal">
      <FileText size={14} aria-hidden="true" className="flex-none text-muted" />
      <span className="sr-only">Download</span> <span className="truncate">{name}</span>
    </DownloadPdfButton>
  );
}
