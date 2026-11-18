"use client";

import { useSyncExternalStore } from "react";

import type { AiProvider } from "@/generated/prisma/enums";
import { providerOption } from "@/lib/ai/provider-options";
import { cn } from "@/lib/cn";
import { isPrivateAddress } from "@/lib/private-host";

/** PRIVACY.md, which says all of this at length. */
const PRIVACY_URL = "https://github.com/AienTech/dossier/blob/main/PRIVACY.md";

type AiChoice = { provider: AiProvider; baseUrl: string };

// The provider the AI section has chosen, for the column beside it: the
// section publishes each change, and the column follows.
let choice: AiChoice | null = null;
const listeners = new Set<() => void>();

/** Called by the AI section when the provider or its address changes. */
export function publishAiChoice(next: AiChoice) {
  if (choice?.provider === next.provider && choice.baseUrl === next.baseUrl) return;
  choice = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Where the AI provider runs (ST3): Ollama and LM Studio on your hardware,
 * an OpenAI-compatible server by its address, the others hosted.
 */
export function whereItRuns(provider: AiProvider, baseUrl: string): "computer" | "network" | "hosted" {
  if (providerOption(provider).local) return "computer";
  if (provider === "OPENAI" && isPrivateAddress(baseUrl)) return /\/\/(localhost|127\.|\[::1\]|host\.docker\.internal)/.test(baseUrl) ? "computer" : "network";
  return "hosted";
}

type Flow = { title: string; text: string; leaves: boolean };

function flowsFor(provider: AiProvider, baseUrl: string): { lead: string; flows: Flow[] } {
  const option = providerOption(provider);
  const where = whereItRuns(provider, baseUrl);
  const stays = [
    { title: "Your password and keys", text: "Never. Keys are stored encrypted here and sent only to their own service.", leaves: false },
    { title: "Your applications and notes", text: "Stay in your database. Exports are files you download.", leaves: false },
  ];
  if (where !== "hosted") {
    const place = where === "computer" ? "this computer" : "your network";
    return {
      lead: `Nothing leaves ${place}. With ${option.name} chosen, Dossier's AI runs on your own hardware.`,
      flows: [{ title: "Your profile and the posting", text: `Sent to ${option.name} on ${place} when it tailors a resume or letter, or answers a reply.`, leaves: false }, ...stays],
    };
  }
  const to = option.vendor ?? "this server";
  return {
    lead: option.vendor
      ? `With ${option.vendor} chosen, here's what leaves this server, and when. How long it's kept depends on your account with ${option.vendor}.`
      : "With this server chosen, here's what leaves Dossier's, and when. How long it's kept is up to whoever runs it.",
    flows: [
      { title: "Your profile and the posting", text: `Sent to ${to} when it tailors a resume or letter, or answers a reply. Your contact details stay here; the notes on an application are never sent.`, leaves: true },
      { title: "Postings, for scoring", text: "Sent when a posting is scored, by you or the job agent, to the scoring model in Settings → Scoring.", leaves: true },
      { title: "A resume you import", text: `Sent whole to ${to}, contact details included, to read it into your profile.`, leaves: true },
      { title: "Replies, with Gmail connected", text: "Each reply it reads or answers, with the earlier mail in the thread.", leaves: true },
      ...stays,
    ],
  };
}

/**
 * "Where your data goes" (E34-4, design 9a): beside the AI section, each
 * flow of data for the provider chosen there, warning when it leaves the
 * server and success when it stays.
 */
export function AiDataFlows({ initial }: { initial: AiChoice }) {
  const current = useSyncExternalStore(subscribe, () => choice ?? initial, () => initial);
  const { lead, flows } = flowsFor(current.provider, current.baseUrl);
  return (
    <section aria-labelledby="data-flows-title" className="flex flex-col gap-4 rounded-card bg-input px-6 py-5">
      <div className="flex flex-col gap-1">
        <h2 id="data-flows-title" className="text-[15px] font-medium">
          Where your data goes
        </h2>
        <p className="text-label text-pretty text-muted">{lead}</p>
      </div>
      <ul className="flex flex-col">
        {flows.map((flow) => (
          <li key={flow.title} className="flex gap-2.5 border-t border-line py-3">
            <span aria-hidden="true" className={cn("mt-[7px] size-[7px] flex-none rounded-full", flow.leaves ? "bg-warning" : "bg-success")} />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {flow.title}
                <span className="sr-only">{flow.leaves ? ", leaves this server" : ", stays here"}</span>
              </span>
              <span className="text-label text-pretty text-muted">{flow.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="self-start text-label underline underline-offset-2">
        Read the privacy page ↗<span className="sr-only"> (opens in a new tab)</span>
      </a>
    </section>
  );
}
