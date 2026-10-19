"use client";

import { Conversation } from "@/components/email/conversation";
import type { EmailView } from "@/lib/google/inbox-data";

/**
 * The Conversation tab (E15-3): the application's mail through Gmail, with
 * the AI's reading of each reply and a drafted answer for the newest one.
 */
export function ConversationTab({ emails, aiReady, timeZone, reading }: { emails: EmailView[]; aiReady: boolean; timeZone?: string; reading: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-16">
      <div className="flex w-full max-w-[680px] flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-muted">
        <span>Conversation</span>
        <span>{reading ? "From your Gmail · checked every few minutes" : "Reading replies is off in Settings → Google"}</span>
      </div>
      <div className="w-full max-w-[680px]">
        {emails.length === 0 ? (
          <p className="rounded-panel border border-line-card bg-card px-7 py-7 text-sm text-muted">
            No mail yet. Send the application with Gmail from the Email tab, and replies show up here.
          </p>
        ) : (
          <Conversation emails={emails} aiReady={aiReady} timeZone={timeZone} />
        )}
      </div>
    </div>
  );
}
