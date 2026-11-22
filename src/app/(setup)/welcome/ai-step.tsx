"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toastResult } from "@/components/toast";
import type { AiErrorKind } from "@/lib/ai/errors";
import { AI_CHOICES, AI_PRIORITIES, aiChoice, type AiChoice, type AiChoiceId, type AiPriority } from "@/lib/setup/ai-choices";

import { saveAiProvider } from "../../(app)/settings/actions";
import { connectAi, findLocalAi } from "./actions";
import { ChoiceCards } from "./choice-cards";
import { InstructionList } from "./instruction-list";

/** What the step starts from: the AI in effect, if it works. */
export type AiStepView = { usable: boolean; name: string; model: string; choice: AiChoiceId | null; fromEnv: boolean };

type Status =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "connected"; model: string; seconds: number }
  | { state: "failed"; kind: AiErrorKind; message: string }
  | { state: "found"; baseUrl: string; models: string[]; model: string | null }
  | { state: "missing" };

/** What to try next after a failed check, in plain words. */
function hint(kind: AiErrorKind, choice: AiChoice): ReactNode {
  switch (kind) {
    case "auth":
      return `Check that you copied the whole key, with nothing before or after it. If it still fails, make a new key and paste that.${choice.id === "anthropic" ? " Claude's key needs a workspace: the default one is fine." : ""}`;
    case "rate-limited":
      return "This usually means there's no credit on the account yet. Add some, wait a minute, and check again.";
    case "unreachable":
      return `Dossier couldn't reach ${choice.name}. Check that this server is online, then try again.`;
    case "model":
      // The key is saved before the models are checked, so Settings lists what the account has (public PR 108).
      return (
        <>
          Your account may not have access to them yet: new accounts sometimes wait a little, so try again later. Or choose a model your account has in{" "}
          <Link href="/settings?section=ai" className="font-medium underline underline-offset-2">
            Settings → AI provider
          </Link>
          , where your key is already saved.
        </>
      );
    default:
      return null;
  }
}

/**
 * The guide's AI step (E21-2): what matters most, then one or two choices
 * for it, then that choice's steps, its key and a check that says in plain
 * words what went wrong. Local ones are found on this computer instead.
 */
export function AiStep({ current }: { current: AiStepView }) {
  const router = useRouter();
  const [changing, setChanging] = useState(!current.usable);
  const [priority, setPriority] = useState<AiPriority | null>(current.choice ? aiChoice(current.choice).priority : null);
  const [choiceId, setChoiceId] = useState<AiChoiceId | null>(current.choice);
  const choices = AI_CHOICES.filter((choice) => choice.priority === priority);

  if (!changing) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-sm">
          Dossier already writes with <strong className="font-medium">{current.name}</strong>
          {current.model && (
            <>
              , using <span className="font-mono text-[13px]">{current.model}</span>
            </>
          )}
          .{current.fromEnv && " It's set on the server, in DOSSIER_AI_PROVIDER."}
        </p>
        <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>
          Choose another
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lead font-medium">What matters most to you?</h2>
        <ChoiceCards
          label="What matters most to you?"
          options={AI_PRIORITIES}
          value={priority}
          onChange={(next) => {
            setPriority(next);
            setChoiceId(AI_CHOICES.find((choice) => choice.priority === next)?.id ?? null);
          }}
        />
      </section>

      {priority && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lead font-medium">Pick one</h2>
          <ChoiceCards
            label="Pick an AI"
            options={choices.map((choice) => ({ value: choice.id, name: choice.name, description: choice.about }))}
            value={choiceId}
            onChange={setChoiceId}
          />
          {priority === "other" && (
            <p className="text-sm text-muted">
              Have an AI server of your own, or another company&apos;s address? Enter it in{" "}
              <Link href="/settings?section=ai" className="font-medium text-ink underline underline-offset-2">
                Settings → AI provider
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {choiceId && <ChoicePanel key={choiceId} choice={aiChoice(choiceId)} onConnected={() => router.refresh()} />}
    </div>
  );
}

function ChoicePanel({ choice, onConnected }: { choice: AiChoice; onConnected: () => void }) {
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const local = choice.key === null;

  const check = async () => {
    setStatus({ state: "checking" });
    if (local) {
      const result = toastResult(await findLocalAi({ choice: choice.id as "lmstudio" | "ollama" }));
      if (!result.ok) return setStatus({ state: "idle" });
      setStatus(result.data.found ? { state: "found", ...result.data } : { state: "missing" });
      if (result.data.found && result.data.model) onConnected();
      return;
    }
    const result = toastResult(await connectAi({ choice: choice.id, key: key.trim() || undefined }));
    if (!result.ok) return setStatus({ state: "idle" });
    if (result.data.connected) {
      setKey("");
      setStatus({ state: "connected", model: result.data.model, seconds: result.data.seconds });
      onConnected();
    } else {
      setStatus({ state: "failed", kind: result.data.kind, message: result.data.message });
    }
  };

  const chooseModel = async (model: string) => {
    if (status.state !== "found") return;
    setStatus({ ...status, model });
    if (toastResult(await saveAiProvider({ provider: choice.provider, baseUrl: status.baseUrl, model })).ok) onConnected();
  };

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-section">{choice.name}</h2>
        <p className="text-sm text-muted">{choice.about}</p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
        <dt className="font-medium">What it costs</dt>
        <dd className="text-pretty text-muted">{choice.cost}</dd>
        {choice.needs && (
          <>
            <dt className="font-medium">Your computer</dt>
            <dd className="text-pretty text-muted">{choice.needs}</dd>
          </>
        )}
        <dt className="font-medium">Your data</dt>
        <dd className="text-pretty text-muted">{choice.data}</dd>
      </dl>
      <InstructionList steps={choice.steps} label={`Setting up ${choice.name}`} />

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (status.state !== "checking") void check();
        }}
      >
        {choice.key && (
          <Input
            label={choice.key.label}
            type="password"
            autoComplete="off"
            placeholder={choice.key.startsWith ? `Starts with ${choice.key.startsWith}` : "Paste it here"}
            hint="Stored encrypted on your server, and never shown again."
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
        )}
        <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
          {status.state === "checking" ? (local ? "Looking…" : "Checking…") : local ? `Find ${choice.name}` : "Check it"}
        </Button>
      </form>

      <div role="status" className="text-sm empty:hidden">
        {status.state === "connected" && (
          <p className="text-success">
            It works: {choice.name} answered in {status.seconds} seconds, with <span className="font-mono text-[13px]">{status.model}</span>.
          </p>
        )}
        {status.state === "failed" && (
          <div className="flex flex-col gap-1.5 rounded-card bg-warning-surface px-4 py-3 text-warning">
            <p className="font-medium">{status.message}</p>
            {hint(status.kind, choice) && <p>{hint(status.kind, choice)}</p>}
          </div>
        )}
        {status.state === "missing" && (
          <div className="flex flex-col gap-1.5 rounded-card bg-warning-surface px-4 py-3 text-warning">
            <p className="font-medium">Dossier couldn&apos;t find {choice.name}.</p>
            <p>
              Check that it&apos;s running{choice.id === "lmstudio" ? ", with its server switched on in the Developer tab" : ""}, then try again. If Dossier runs on a
              server rather than this computer, it can&apos;t reach {choice.name} here: pick another option, or see the wiki to run a model on the server.
            </p>
          </div>
        )}
        {status.state === "found" &&
          (status.models.length === 0 ? (
            <p className="rounded-card bg-warning-surface px-4 py-3 text-warning">
              Found {choice.name}, but it has no models yet. Download one, then press Find again.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-success">Found {choice.name}. Dossier will write with the model below.</p>
              <Select label="Model" value={status.model ?? ""} onChange={(event) => void chooseModel(event.target.value)} className="max-w-[420px]">
                {status.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </Select>
            </div>
          ))}
      </div>

      <a href={choice.help} target="_blank" rel="noopener noreferrer" className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
        More help on the wiki <span className="sr-only">(opens in a new tab)</span>
      </a>
    </Card>
  );
}
