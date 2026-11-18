"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { OPENROUTER_SCORING_MODEL, SCORER_INFO, SCORERS, type Scorer, type ScoringView } from "@/lib/scoring/scorers";
import { WIKI } from "@/lib/setup/instructions";

import { saveOpenRouterScoringModel, saveScorer, saveScoringKey, testScoringModel } from "../../(app)/settings/actions";
import { ChoiceCards } from "./choice-cards";
import { InstructionList } from "./instruction-list";

type Status = { state: "idle" } | { state: "checking" } | { state: "connected" } | { state: "failed"; message: string };

const OPTIONS: readonly { value: Scorer; name: string; description: string; tag: string }[] = SCORERS.map((scorer) =>
  scorer === "AI"
    ? { value: scorer, name: "Your AI", description: "The AI you chose scores each posting and says in its own words why it fits. Nothing more to set up.", tag: "Recommended" }
    : { value: scorer, name: SCORER_INFO[scorer].name, description: SCORER_INFO[scorer].description, tag: SCORER_INFO[scorer].tag },
);

/**
 * The guide's scoring step (E21-4, E25-8): Score in Positions and the job
 * agent use your AI unless you choose another scoring model from the list,
 * which comes with its key steps and a check.
 */
export function ScoringStep({ initial }: { initial: ScoringView }) {
  const router = useRouter();
  const [scorer, setScorer] = useState<Scorer>(initial.scorer);
  const [key, setKey] = useState("");
  const [model, setModel] = useState(initial.openrouterModel === OPENROUTER_SCORING_MODEL ? "" : initial.openrouterModel);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const info = SCORER_INFO[scorer];

  const choose = async (next: Scorer) => {
    setScorer(next);
    setKey("");
    setStatus({ state: "idle" });
    if (toastResult(await saveScorer({ scorer: next })).ok) router.refresh();
  };

  const check = async () => {
    setStatus({ state: "checking" });
    if (key.trim() && !toastResult(await saveScoringKey({ scorer, change: { action: "set", value: key } })).ok) return setStatus({ state: "idle" });
    if (scorer === "OPENROUTER" && !toastResult(await saveOpenRouterScoringModel({ model })).ok) return setStatus({ state: "idle" });
    const result = toastResult(await testScoringModel({ scorer }));
    if (!result.ok) return setStatus({ state: "idle" });
    if (!result.data.connected) return setStatus({ state: "failed", message: result.data.message });
    setKey("");
    setStatus({ state: "connected" });
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-8">
      <ChoiceCards label="Score postings with" options={OPTIONS} value={scorer} onChange={(next) => void choose(next)} />
      {info.key && info.setup && (
        <Card className="flex flex-col gap-6">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="font-medium">What it costs</dt>
            <dd className="text-pretty text-muted">{info.setup.cost}</dd>
            <dt className="font-medium">Your data</dt>
            <dd className="text-pretty text-muted">{info.setup.data}</dd>
          </dl>
          <InstructionList label={`Setting up ${info.name}`} steps={info.setup.steps} />
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (status.state !== "checking") void check();
            }}
          >
            <Input
              label={info.key.label}
              type="password"
              autoComplete="off"
              placeholder={initial.keys[scorer] === "set" ? "Saved · paste a new one to replace it" : "Paste it here"}
              hint="Stored encrypted on your server, and never shown again."
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            {scorer === "OPENROUTER" && (
              <Input
                label="Model"
                placeholder={OPENROUTER_SCORING_MODEL}
                hint={`An OpenRouter model that answers in JSON, by its id. Empty for ${OPENROUTER_SCORING_MODEL}, a cheap one that does.`}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            )}
            <Button type="submit" className="self-start" aria-disabled={status.state === "checking" || undefined}>
              {status.state === "checking" ? "Checking…" : "Check it"}
            </Button>
          </form>
          <div role="status" className="text-sm empty:hidden">
            {status.state === "connected" && <p className="text-success">It works: {info.name} answered.</p>}
            {status.state === "failed" && <p className="rounded-card bg-warning-surface px-4 py-3 font-medium text-warning">{status.message}</p>}
          </div>
          <a href={`${WIKI}/Choosing-an-AI-provider#${info.setup.wikiAnchor}`} target="_blank" rel="noopener noreferrer" className="self-start text-meta text-muted underline underline-offset-2 hover:text-ink">
            More help on the wiki <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Card>
      )}
    </div>
  );
}
