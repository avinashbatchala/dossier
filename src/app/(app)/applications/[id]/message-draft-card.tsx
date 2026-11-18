"use client";

import { AlertDialog } from "radix-ui";
import { useState, useTransition } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { mailtoHref } from "@/lib/application-email";
import { copyText } from "@/lib/copy-text";
import { sendMessageWithGmail } from "@/lib/google/actions";
import { MESSAGE_TITLES, type MessageDraft } from "@/lib/message-draft";

import { discardMessageDraft, markMessageSent, saveMessageDraft } from "./actions";

/**
 * A message drafted on a click (E30-7, E30-8): an answer to the offer or a
 * follow-up, with a stronger border like the conversation's drafts. In the
 * Gmail thread it's sent from here after a confirmation; otherwise it's
 * copied or opened in the mail app, and "I sent it" lets it go and starts
 * "Quiet for" again (decided 17 November).
 */
export function MessageDraftCard({
  applicationId,
  draft,
  inThread,
  writing,
  onWriteAgain,
}: {
  applicationId: string;
  draft: MessageDraft;
  /** It can go out with Gmail, in the application's thread. */
  inThread: boolean;
  /** It's being drafted again. */
  writing: boolean;
  onWriteAgain: () => void;
}) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = pending || writing;
  const save = () => (subject !== draft.subject || body !== draft.body) && void saveMessageDraft({ id: applicationId, subject, body }).then(toastResult);
  const run = (work: () => Promise<unknown>) => startTransition(async () => void (await work()));

  return (
    <section aria-label={MESSAGE_TITLES[draft.kind]} aria-busy={busy || undefined} className="flex w-full max-w-[820px] flex-col gap-3 rounded-panel border border-line-strong bg-card px-6 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-baseline gap-2 text-[15px] font-medium">
          <span aria-hidden="true" className="text-muted">
            ✦
          </span>
          {MESSAGE_TITLES[draft.kind]}
        </h2>
        <span className="text-meta text-muted">{inThread ? "An answer in your Gmail thread" : draft.to ? `To ${draft.to}` : "Copy it into your mail app"}</span>
      </div>
      <input
        aria-label="Subject"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
        onBlur={save}
        className="rounded-control border border-line-input bg-input px-3 py-2 text-field focus-visible:border-primary focus-visible:outline-offset-0"
      />
      <textarea
        aria-label="Message"
        value={body}
        rows={Math.min(16, Math.max(6, body.split("\n").length + 1))}
        onChange={(event) => setBody(event.target.value)}
        onBlur={save}
        className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-2.5 text-field leading-[1.6] focus-visible:border-primary focus-visible:outline-offset-0"
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {inThread ? (
          <Button aria-disabled={busy || !body.trim() || undefined} onClick={() => !busy && body.trim() && setConfirming(true)}>
            Send reply
          </Button>
        ) : (
          <Button
            aria-disabled={busy || undefined}
            onClick={() => !busy && run(async () => void (toastResult(await markMessageSent({ id: applicationId })).ok && toast("Noted. “Quiet for” starts again from today.")))}
          >
            I sent it
          </Button>
        )}
        <Button variant="secondary" onClick={() => void copyText(body).then((copied) => toast(copied ? "Copied the message." : "That didn't copy. Select the text and copy it yourself."))}>
          Copy
        </Button>
        <a href={mailtoHref({ to: draft.to, subject, body })} className={buttonClassName("secondary", "md")}>
          Open in mail app
        </a>
        <Button variant="text" aria-disabled={busy || undefined} onClick={() => !busy && onWriteAgain()}>
          {writing ? "Writing it again…" : "Write it again"}
        </Button>
        <Button variant="text" size="sm" className="ml-auto" aria-disabled={busy || undefined} onClick={() => !busy && run(async () => toastResult(await discardMessageDraft({ id: applicationId })))}>
          Discard
        </Button>
      </div>

      <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
            <AlertDialog.Title className="font-serif text-[22px] leading-tight">Send it?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted">In the same Gmail thread as the application. This can&apos;t be unsent.</AlertDialog.Description>
            <div className="min-h-0 overflow-auto rounded-control border border-line bg-canvas px-4 py-3 text-control leading-[1.6] whitespace-pre-wrap">{body}</div>
            <div className="mt-2 flex justify-end gap-2">
              <AlertDialog.Cancel className={buttonClassName("secondary", "sm")}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                className={buttonClassName("primary", "sm", "hover:text-on-primary")}
                onClick={() =>
                  run(async () => {
                    await saveMessageDraft({ id: applicationId, subject, body });
                    toastResult(await sendMessageWithGmail({ id: applicationId }));
                  })
                }
              >
                Send now
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
