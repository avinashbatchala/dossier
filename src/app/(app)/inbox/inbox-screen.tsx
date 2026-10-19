"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { formatWhen, KIND_LABELS } from "@/components/email/conversation";
import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { checkInbox, dismissEmail, linkEmail } from "@/lib/google/actions";
import type { EmailView, Inbox } from "@/lib/google/inbox-data";

const card = "flex flex-col rounded-panel border border-line-card bg-card px-7 pt-[22px] pb-3";

/** The inbox (E15-3): what needs an answer, what needs a link, and what just happened. */
export function InboxScreen({
  inbox,
  connected,
  configured,
  lastSync,
  problem,
  timeZone,
  applications,
}: {
  inbox: Inbox;
  /** Reading replies is on and allowed. */
  connected: boolean;
  /** The server has a Google client. */
  configured: boolean;
  lastSync: Date | null;
  problem: string | null;
  aiReady: boolean;
  timeZone?: string;
  /** For linking a mail by hand. */
  applications: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [checking, startChecking] = useTransition();
  const check = () =>
    startChecking(async () => {
      toastResult(await checkInbox({}));
      router.refresh();
    });
  const empty = inbox.waiting.length + inbox.unmatched.length + inbox.updates.length === 0;

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          connected
            ? "Employers' replies from your Gmail, linked to their applications. Open one to see what it asks and draft your answer."
            : "Connect Gmail in Settings → Google, and employers' replies show up here, linked to their applications."
        }
        actions={
          connected ? (
            <>
              <span className={problem ? "text-meta text-error" : "text-meta text-muted"}>
                {problem ?? (lastSync ? `Checked ${formatWhen(lastSync, timeZone)}` : "Not checked yet")}
              </span>
              <Button variant="secondary" onClick={check} disabled={checking}>
                {checking ? "Checking…" : "Check now"}
              </Button>
            </>
          ) : (
            <Link href="/settings?section=google" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              {configured ? "Connect Gmail" : "Set up Google"}
            </Link>
          )
        }
      />
      <div className="flex max-w-[860px] flex-col gap-5 px-10 pb-[72px]">
        {empty ? (
          <p className={`${card} py-6! text-sm text-muted`}>{connected ? "Nothing yet. Replies to your applications will show up here." : "Nothing here yet."}</p>
        ) : (
          <>
            <Section title="Needs an answer" count={inbox.waiting.length} empty="All answered. Nice.">
              {inbox.waiting.map((email) => (
                <Row key={email.id} email={email} timeZone={timeZone} />
              ))}
            </Section>
            {inbox.unmatched.length > 0 && (
              <Section title="Needs a look" count={inbox.unmatched.length} hint="I couldn't tell which application these are about.">
                {inbox.unmatched.map((email) => (
                  <Unmatched key={email.id} email={email} timeZone={timeZone} applications={applications} />
                ))}
              </Section>
            )}
            {inbox.updates.length > 0 && (
              <Section title="Updates" count={inbox.updates.length}>
                {inbox.updates.map((email) => (
                  <Row key={email.id} email={email} timeZone={timeZone} quiet />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Section({ title, count, hint, empty, children }: { title: string; count: number; hint?: string; empty?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={card}>
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        <span className="text-meta text-muted">{count}</span>
      </div>
      {hint && <p className="-mt-1.5 pb-3 text-meta text-muted">{hint}</p>}
      {count === 0 && empty ? <p className="border-t border-line py-5 text-sm text-muted">{empty}</p> : <ul>{children}</ul>}
    </section>
  );
}

/** A reply linked to its application; opens the application's Conversation tab. */
function Row({ email, timeZone, quiet }: { email: EmailView; timeZone?: string; quiet?: boolean }) {
  const application = email.application!;
  return (
    <li className="-mx-2.5 border-t border-line">
      <Link href={`/applications/${application.id}?tab=conversation`} className="flex items-start gap-3 rounded-control px-2.5 py-[13px] text-ink hover:bg-hover">
        <StatusDot status={application.status} className="mt-1.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2 text-field font-medium">
            {[application.company, application.role].filter(Boolean).join(", ")}
            <span className="text-meta font-normal text-muted">· {email.fromName || email.fromAddress}</span>
          </span>
          <span className="text-meta leading-[1.45] text-muted">{email.summary || email.subject}</span>
        </span>
        <span className="mt-px flex flex-none flex-col items-end gap-0.5 text-meta text-muted">
          <span>{formatWhen(email.sentAt, timeZone)}</span>
          {email.kind && <span className={quiet ? "" : "text-ink"}>{KIND_LABELS[email.kind]}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Mail that isn't linked: pick its application, or hide it. */
function Unmatched({ email, timeZone, applications }: { email: EmailView; timeZone?: string; applications: { id: string; label: string }[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean }>) =>
    startTransition(async () => {
      if ((await work()).ok) router.refresh();
    });
  return (
    <li className="-mx-2.5 flex flex-col gap-2.5 border-t border-line px-2.5 py-[13px]">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-field font-medium">{email.fromName || email.fromAddress}</span>
          <span className="truncate text-meta text-muted">{email.subject || email.body.slice(0, 120)}</span>
        </span>
        <span className="flex-none text-meta text-muted">{formatWhen(email.sentAt, timeZone)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Link to application"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          className="h-[30px] max-w-[320px] min-w-0 flex-1 cursor-pointer rounded-control border border-line-input bg-input px-2 text-control"
        >
          <option value="">Choose application…</option>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>
              {application.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" disabled={!choice || pending} onClick={() => run(async () => toastResult(await linkEmail({ emailId: email.id, applicationId: choice })))}>
          Link
        </Button>
        <Button size="sm" variant="text" className="ml-auto" disabled={pending} onClick={() => run(async () => toastResult(await dismissEmail({ emailId: email.id })))}>
          Not job-related
        </Button>
      </div>
    </li>
  );
}
