"use client";

import Link from "next/link";
import { RadioGroup } from "radix-ui";
import { useState } from "react";

import { KeyField } from "@/components/key-field";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SCORER_INFO, SCORERS, TYPESAFE_KEY_URL, type Scorer, type ScoringView } from "@/lib/scoring/scorers";
import { cn } from "@/lib/cn";

import { saveScorer, saveTypesafeKey, testJev } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

type Connection =
  | { status: "untested" }
  | { status: "testing" }
  | { status: "connected"; model: string; seconds: number }
  | { status: "failed"; message: string };

/**
 * Settings → Scoring (#274): whether Score in Find jobs and the job agent
 * use the AI model or Jev, and Jev's key. Each change saves on its own; the
 * key is saved when you leave its field and never shown again.
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
    return apply(toastResult(await track(saveTypesafeKey({ change }))));
  };

  const test = async () => {
    if (connection.status === "testing") return;
    setConnection({ status: "testing" });
    const result = await testJev({});
    if (!result.ok) setConnection({ status: "failed", message: result.error });
    else if (result.data.connected) setConnection({ status: "connected", model: result.data.model, seconds: result.data.seconds });
    else setConnection({ status: "failed", message: result.data.message });
  };

  return (
    <>
      <SettingsSectionIntro title="Scoring">
        How Score in Find jobs and the job agent judge how well a posting fits your profile. Drafts are always written by your AI model.
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

      {view.scorer === "JEV" && (
        <>
          <p role="note" className="rounded-card bg-warning-surface px-4 py-3 text-meta text-warning">
            Each posting you score goes to TypeSafe with your profile, without your name or contact details. Jev reads English best: postings in other languages are
            judged less well.
          </p>

          <Card className="flex flex-col gap-5">
            <KeyField
              label="TypeSafe key"
              keyState={view.keyState}
              envName="DOSSIER_TYPESAFE_KEY"
              getKey={{ href: TYPESAFE_KEY_URL, text: "the TypeSafe console" }}
              onSave={saveKey}
            />
            <div className="flex flex-wrap items-center gap-3.5 pt-1">
              <Button variant="secondary" onClick={() => void test()} disabled={connection.status === "testing"}>
                {connection.status === "testing" ? "Testing…" : "Test connection"}
              </Button>
              <ConnectionStatus connection={connection} />
            </div>
          </Card>

          <p className="text-sm text-muted">
            Jev&apos;s scores and your AI model&apos;s aren&apos;t on the same scale. If the job agent queues too many postings or too few, change its minimum score in{" "}
            <Link href="/settings?section=agent" className="underline underline-offset-2 hover:text-ink">
              Settings → Job agent
            </Link>
            .
          </p>
        </>
      )}
    </>
  );
}

function ConnectionStatus({ connection }: { connection: Connection }) {
  const [dot, text, message] =
    connection.status === "connected"
      ? ["bg-success", "text-success", `Connected · ${connection.model} answered in ${connection.seconds.toLocaleString("en-US")} s`]
      : connection.status === "failed"
        ? ["bg-error", "text-error", connection.message]
        : connection.status === "testing"
          ? ["bg-status-offer", "text-muted", "Asking Jev one short question…"]
          : ["bg-faint", "text-muted", "Not tested since your last change · a test costs a few dozen tokens"];
  return (
    <p role="status" className={cn("flex items-center gap-2 text-control", text)}>
      <span aria-hidden className={cn("size-2 flex-none rounded-full", dot)} />
      {message}
    </p>
  );
}
