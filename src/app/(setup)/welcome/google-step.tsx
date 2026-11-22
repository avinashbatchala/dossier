"use client";

import { useState } from "react";

import { toast } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setupHref } from "@/lib/setup-guide";
import { GOOGLE_HELP, GOOGLE_STEPS } from "@/lib/setup/google";

import { CALLBACK_MESSAGES, ClientCard, type GoogleClientView, type GoogleConnectionView } from "../../(app)/settings/google-section";
import { InstructionList } from "./instruction-list";

const CONNECT = `/api/google/connect?return=${encodeURIComponent(setupHref("google"))}`;

/**
 * The guide's Gmail and Calendar step (E21-5): what it does, an address
 * Google won't take spotted first, Google Cloud's steps with the redirect
 * address to copy, the client saved right there, and Connect, which comes
 * back here.
 */
export function GoogleStep({
  connection,
  client,
  redirectUri,
  addressProblem,
  outcome,
}: {
  connection: GoogleConnectionView;
  client: GoogleClientView;
  redirectUri: string;
  addressProblem: "http" | "ip" | null;
  /** What came back from Google's consent page, if anything. */
  outcome: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
    } catch {
      toast("That didn't copy. Select the address and copy it yourself.");
    }
  };
  const message = outcome ? CALLBACK_MESSAGES[outcome] : null;

  if (connection.status === "connected") {
    return (
      <Card className="flex flex-col gap-2">
        <p className="text-sm">
          Connected as <strong className="font-medium">{connection.email}</strong>. Settings → Google is where you choose what Dossier reads and your working hours.
        </p>
        <p className="text-meta text-muted">Changing your Google password disconnects Dossier: connect again in Settings → Google when that happens.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p role="status" className="rounded-card bg-warning-surface px-4 py-3 text-sm font-medium text-warning">
          {message}
        </p>
      )}
      {addressProblem ? (
        <Card className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Google won&apos;t accept this server&apos;s address yet.</p>
          <p className="text-pretty text-muted">
            {addressProblem === "ip"
              ? "Google needs a name, such as jobs.example.com, rather than numbers such as 192.168.1.20."
              : "Google needs an address that starts with https://, unless it's localhost."}{" "}
            Dossier is at <span className="font-mono text-[13px] [overflow-wrap:anywhere]">{new URL(redirectUri).origin}</span>. Give it a domain name with https (the
            wiki&apos;s install guides show how), or skip this step for now.
          </p>
          <a href={GOOGLE_HELP} target="_blank" rel="noopener noreferrer" className="self-start font-medium text-ink underline underline-offset-2">
            More help on the wiki <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Card>
      ) : (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">Nothing. Google Cloud may ask for billing details for other services; Gmail and Calendar don&apos;t need it.</dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">
              Your mail and calendar stay with Google. Dossier reads the replies to your applications, and the AI you chose reads them to draft your answers. Nothing
              is sent without you pressing Send.
            </dd>
          </dl>
          <InstructionList steps={GOOGLE_STEPS} label="Setting up Google" />
          <div className="flex flex-col gap-2">
            <span className="text-label font-medium">The address to paste in step 6</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-control border border-line-field bg-input px-3 py-2 font-mono text-label [overflow-wrap:anywhere]">{redirectUri}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-label text-muted">If Google says redirect_uri_mismatch, wait a few minutes and try again: a new address can take that long to work.</p>
          </div>
          <ClientCard initial={client} connected={false} />
          <div className="flex flex-wrap items-center gap-3">
            {connection.status === "not-configured" ? (
              <Button aria-disabled title="Save the client ID and secret first">
                Connect Google
              </Button>
            ) : (
              <a href={CONNECT} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
                Connect Google
              </a>
            )}
            <a href={GOOGLE_HELP} target="_blank" rel="noopener noreferrer" className="text-meta text-muted underline underline-offset-2 hover:text-ink">
              More help on the wiki <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
