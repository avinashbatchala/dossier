"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import type { Creativity } from "@/generated/prisma/enums";

import { updateSettings } from "./actions";

type Behaviour = { creativity: Creativity; strict: boolean; showDiff: boolean; dailyNoteAi: boolean };

const CREATIVITY_OPTIONS: { value: Creativity; label: string }[] = [
  { value: "FAITHFUL", label: "Faithful" },
  { value: "BALANCED", label: "Balanced" },
  { value: "EXPRESSIVE", label: "Expressive" },
];

/**
 * How the AI writes (E10-2, SET-3 to SET-5), below the provider form. Each
 * control saves as it changes.
 */
export function AiBehaviour({ initial }: { initial: Behaviour }) {
  const track = useTrackSave();
  const [behaviour, setBehaviour] = useState(initial);

  const change = (next: Partial<Behaviour>) => {
    const previous = behaviour;
    setBehaviour({ ...behaviour, ...next });
    void track(updateSettings(next)).then((result) => {
      if (!toastResult(result).ok) setBehaviour(previous);
    });
  };

  return (
    <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-2.5">
      <div className="flex flex-wrap items-center gap-5 py-4">
        <div className="flex min-w-[220px] flex-1 flex-col gap-[3px]">
          <span id="creativity-label" className="text-field">
            Creativity
          </span>
          <p id="creativity-description" className="text-meta text-muted">
            Lower keeps drafts close to your own wording. Higher takes more liberties with phrasing, but never with facts.
          </p>
        </div>
        <SegmentedControl
          aria-labelledby="creativity-label"
          aria-describedby="creativity-description"
          size="sm"
          options={CREATIVITY_OPTIONS}
          value={behaviour.creativity}
          onValueChange={(creativity) => change({ creativity })}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-line py-4">
        <Toggle
          label="Never invent experience"
          description="Drafts may only use facts from your profile. If a job asks for something you don't have, I'll say so instead of making it up."
          checked={behaviour.strict}
          onCheckedChange={(strict) => change({ strict })}
        />
        {!behaviour.strict && (
          <p role="status" className="rounded-control bg-warning-surface px-3 py-2 text-meta text-warning">
            Heads up: drafts may now stretch beyond your profile. Double-check before sending.
          </p>
        )}
      </div>
      <Toggle
        className="border-t border-line py-4"
        label="Show what changed"
        description="After each draft, list what was tailored compared with your base resume."
        checked={behaviour.showDiff}
        onCheckedChange={(showDiff) => change({ showDiff })}
      />
      <Toggle
        className="border-t border-line py-4"
        label="Write the daily note with AI"
        description="A short, kind note at the top of the dashboard, once a day. Nothing about you goes into it. Off, Dossier picks one of its own."
        checked={behaviour.dailyNoteAi}
        onCheckedChange={(dailyNoteAi) => change({ dailyNoteAi })}
      />
    </Card>
  );
}
