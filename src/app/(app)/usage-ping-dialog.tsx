"use client";

import { Dialog } from "radix-ui";
import { useRef, useState } from "react";

import { toast } from "@/components/toast";
import { buttonClassName } from "@/components/ui/button";

import { chooseUsagePing } from "./actions";

/** PRIVACY.md's section on the usage ping, for the rest of what the question says. */
export const USAGE_PING_PRIVACY_URL = "https://github.com/AienTech/dossier/blob/main/PRIVACY.md#usage-ping";

const LINK = "font-medium text-ink underline underline-offset-2";

/**
 * Asks once after sign-in whether to send the usage ping (#172). Consent has
 * to be a free choice: both answers look the same, neither has focus at
 * first, and closing the dialog (Escape, or a click outside) is a no. Its
 * wording is USAGE_PING_TEXT_VERSION: change that with it.
 */
export function UsagePingDialog({ host }: { host: string }) {
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const content = useRef<HTMLDivElement>(null);

  const answer = async (send: boolean) => {
    if (saving) return;
    setSaving(true);
    const result = await chooseUsagePing({ send });
    setSaving(false);
    if (!result.ok) return toast(result.error);
    setOpen(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && void answer(false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          ref={content}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            // The dialog itself takes focus, so neither answer looks preselected.
            event.preventDefault();
            content.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu focus:outline-none"
        >
          <Dialog.Title className="font-serif text-[22px] leading-tight">Send a daily usage ping?</Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-2.5 text-sm text-muted">
              <p>
                Once on each day you use Dossier, your server would send <span className="text-ink">{host}</span> a random install ID and
                the version number, so the project knows how many installs are in use and how often.
              </p>
              <ul className="flex list-disc flex-col gap-1 pl-5">
                <li>Nothing else: no profile, documents, applications, settings or server address. The receiver doesn&apos;t keep the address the ping comes from.</li>
                <li>It goes to the Dossier project&apos;s maintainer, on the project&apos;s own server in Germany. No other service handles it on the way.</li>
                <li>What it keeps is deleted after a year.</li>
              </ul>
              <p>
                Nothing is sent unless you choose Send usage ping. You can change your mind in Settings → About, or with DOSSIER_TELEMETRY on the
                server. To have what was kept deleted, send the install ID to{" "}
                <a href="mailto:dossier.app@pm.me" className={LINK}>
                  dossier.app@pm.me
                </a>
                .{" "}
                <a href={USAGE_PING_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                  More in Privacy <span className="sr-only">(opens in a new tab)</span>
                </a>
              </p>
            </div>
          </Dialog.Description>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonClassName("secondary", "sm")} disabled={saving} onClick={() => void answer(false)}>
              Don&apos;t send
            </button>
            <button type="button" className={buttonClassName("secondary", "sm")} disabled={saving} onClick={() => void answer(true)}>
              Send usage ping
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
