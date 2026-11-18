"use client";

import Link from "next/link";
import { RadioGroup } from "radix-ui";
import { useState, type ReactNode } from "react";

import { KeyField } from "@/components/key-field";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OPENROUTER_SCORING_MODEL, SCORER_INFO, SCORERS, type Scorer, type ScoringView } from "@/lib/scoring/scorers";
import { cn } from "@/lib/cn";

import { saveOpenRouterScoringModel, saveScorer, saveScoringKey, testScoringModel } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; model: string; seconds: number }
  | { status: "failed"; message: string };

/**
 * Settings → Scoring (#274, E25-2): which scoring model judges how well
 * postings fit, from the one list of them, with the chosen one's key and a
 * connection test. Each change saves on its own; a key is saved when you
 * leave its field and never shown again.
 */
export function ScoringSection({ initial }: { initial: ScoringView }) {
  const track = useTrackSave();
  const [view, setView] = useState(initial);
  const [connection, setConnection] = useState<Connection>({ status: "untested" });

  const apply = (result: Awaited<ReturnType<typeof saveScorer>>) => {
    if (result.ok) setView(result.data);
    return result.ok;
  };

  const choose = async (scorer: Scorer) => {
    setView((current) => ({ ...current, scorer }));
    setConnection({ status: "untested" });
    apply(toastResult(await track(saveScorer({ scorer }))));
  };

  const saveKey = async (change: { action: "set"; value: string } | { action: "clear" }) => {
    setConnection({ status: "untested" });
    return apply(toastResult(await track(saveScoringKey({ scorer: view.scorer, change }))));
  };

  const test = async () => {
    if (connection.status === "testing") return;
    setConnection({ status: "testing" });
    const result = await testScoringModel({ scorer: view.scorer });
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", model: result.data.model, seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  return (
    <>
      <SettingsSectionIntro title="Scoring">
        Which model judges how well a posting fits a profile, for Score in Positions, New application and the job agent. Every model answers the same questions,
        and Dossier adds the answers up the same way. Drafts are always written by your AI model.
      </SettingsSectionIntro>

      <RadioGroup.Root
        aria-label="Score postings with"
        value={view.scorer}
        onValueChange={(value) => void choose(value as Scorer)}
        className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3"
      >
        {SCORERS.map((scorer) => (
          <RadioGroup.Item
            key={scorer}
            value={scorer}
            aria-label={SCORER_INFO[scorer].name}
            aria-describedby={`scorer-${scorer}`}
            className="group flex flex-col gap-1.5 rounded-card border border-line-card bg-card p-[18px] text-left hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_1px_var(--color-primary)]"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[15px] font-medium">{SCORER_INFO[scorer].name}</span>
              <span
                aria-hidden
                className="grid size-4 place-items-center rounded-full border-[1.5px] border-line-strong group-data-[state=checked]:border-primary"
              >
                <RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
              </span>
            </span>
            <span id={`scorer-${scorer}`} className="flex flex-col gap-1.5">
              <span className="text-meta text-muted">{SCORER_INFO[scorer].description}</span>
              <span className="text-xs text-muted">{SCORER_INFO[scorer].tag}</span>
            </span>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      <ChosenModel
        scorer={view.scorer}
        keyState={view.keys[view.scorer] ?? null}
        connection={connection}
        onSaveKey={saveKey}
        onTest={() => void test()}
        model={
          view.scorer === "OPENROUTER" ? (
            <Input
              label="Model"
              hint={`An OpenRouter model that answers in JSON, by its id. Empty for ${OPENROUTER_SCORING_MODEL}.`}
              defaultValue={view.openrouterModel === OPENROUTER_SCORING_MODEL ? "" : view.openrouterModel}
              placeholder={OPENROUTER_SCORING_MODEL}
              onBlur={(event) => {
                if (event.target.value.trim() === (view.openrouterModel === OPENROUTER_SCORING_MODEL ? "" : view.openrouterModel)) return;
                setConnection({ status: "untested" });
                void track(saveOpenRouterScoringModel({ model: event.target.value })).then((result) => apply(toastResult(result)));
              }}
            />
          ) : null
        }
      />
    </>
  );
}

/** The chosen scoring model: what it's sent, its key when it needs one, and its connection test. */
function ChosenModel({
  scorer,
  keyState,
  connection,
  onSaveKey,
  onTest,
  model,
}: {
  scorer: Scorer;
  keyState: ScoringView["keys"][Scorer] | null;
  connection: Connection;
  onSaveKey: (change: { action: "set"; value: string } | { action: "clear" }) => Promise<boolean>;
  onTest: () => void;
  /** OpenRouter's model field, under its key. */
  model: ReactNode;
}) {
  const info = SCORER_INFO[scorer];
  return (
    <>
      {info.privacy && (
        <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
          {info.privacy}
        </p>
      )}
      <Card className="flex flex-col gap-5">
        {info.key ? (
          <KeyField label={info.key.label} keyState={keyState ?? "none"} envName={info.key.envName ?? ""} getKey={info.key.getKey} onSave={onSaveKey} />
        ) : (
          <p className="text-sm text-muted">
            It uses the model chosen in{" "}
            <Link href="/settings?section=ai" className="underline underline-offset-2 hover:text-ink">
              Settings → AI provider
            </Link>
            .
          </p>
        )}
        {model}
        <div className="flex flex-wrap items-center gap-3.5 pt-1">
          <Button variant="secondary" onClick={onTest} disabled={connection.status === "testing"}>
            {connection.status === "testing" ? "Testing…" : "Test connection"}
          </Button>
          <ConnectionStatus connection={connection} testing={info.testing} />
        </div>
      </Card>
    </>
  );
}

function ConnectionStatus({ connection, testing }: { connection: Connection; testing: string }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${connection.model} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", testing]
          : ["bg-faint", "text-muted", "Not tested since your last change · a test costs a few dozen tokens"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
