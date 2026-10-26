"use client";

import { useEffect, useRef, useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { controlClassName } from "@/components/ui/field";
import { useAutosave } from "@/hooks/use-autosave";
import { cn } from "@/lib/cn";
import { createFact, removeFact, restoreFact, saveFact } from "@/lib/fact-actions";
import type { FactItem } from "@/lib/profile";

/**
 * Facts the user tells the AI (PRO-14, APP-15), one text box each: "Add a
 * fact" adds a blank one and focuses it, typing autosaves, and Remove takes
 * effect at once with Undo in the toast. `applicationId` is null for the
 * profile's own.
 */
export function FactList({
  applicationId,
  facts,
  setFacts,
  placeholder,
}: {
  applicationId: string | null;
  facts: FactItem[];
  setFacts: (change: (facts: FactItem[]) => FactItem[]) => void;
  placeholder: string;
}) {
  const track = useTrackSave();
  const [adding, setAdding] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // For the toast's Undo, which runs after later changes.
  const latest = useRef(facts);
  useEffect(() => {
    latest.current = facts;
  });

  async function add() {
    setAdding(true);
    const result = await track(createFact({ applicationId }));
    setAdding(false);
    if (!result.ok) return toast(result.error);
    setFacts((current) => [...current, result.data]);
    setCreatedId(result.data.id);
  }

  async function remove(fact: FactItem) {
    const index = facts.findIndex((entry) => entry.id === fact.id);
    const putBack = (restored: FactItem) =>
      setFacts(() => latest.current.toSpliced(Math.min(index, latest.current.length), 0, restored));

    setFacts((current) => current.filter((entry) => entry.id !== fact.id));
    const result = await track(removeFact({ id: fact.id }));
    if (!result.ok) {
      putBack(fact);
      return toast(result.error);
    }
    // A blank one is gone without a word.
    if (!fact.text.trim()) return;
    toast("Removed a fact.", {
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await track(restoreFact({ id: fact.id, applicationId, text: fact.text, sort: result.data.sort }));
          if (!restored.ok) return toast(restored.error);
          putBack(restored.data);
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {facts.length > 0 && (
        <ol aria-label="Facts" className="flex flex-col gap-2.5">
          {facts.map((fact, index) => (
            <FactRow
              key={fact.id}
              fact={fact}
              number={index + 1}
              placeholder={placeholder}
              autoFocus={fact.id === createdId}
              onChange={(text) => setFacts((current) => current.map((entry) => (entry.id === fact.id ? { ...entry, text } : entry)))}
              onRemove={() => void remove(fact)}
            />
          ))}
        </ol>
      )}
      <div>
        <Button variant="secondary" size="sm" onClick={() => void add()} disabled={adding}>
          + Add a fact
        </Button>
      </div>
    </div>
  );
}

function FactRow({
  fact,
  number,
  placeholder,
  autoFocus,
  onChange,
  onRemove,
}: {
  fact: FactItem;
  number: number;
  placeholder: string;
  autoFocus: boolean;
  onChange: (text: string) => void;
  onRemove: () => void;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(fact, (value) => track(saveFact(value)));
  return (
    <li className="flex items-start gap-3">
      <textarea
        aria-label={`Fact ${number}`}
        // Only a fact that was just added takes focus.
        autoFocus={autoFocus}
        rows={1}
        maxLength={1000}
        value={fact.text}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={flush}
        className={cn(controlClassName, "min-h-[42px] resize-none px-3 py-[9px] leading-[1.5] [field-sizing:content] placeholder:text-muted")}
      />
      <Button variant="danger-text" size="sm" className="mt-1.5" aria-label={`Remove fact ${number}`} onClick={onRemove}>
        Remove
      </Button>
    </li>
  );
}
