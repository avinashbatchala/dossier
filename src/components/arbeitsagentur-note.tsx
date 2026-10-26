"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import { ARBEITSAGENTUR_NOTE, ARBEITSAGENTUR_TERMS_URL } from "@/lib/job-search/sources";

/**
 * The Bundesagentur für Arbeit's note (#223), in Settings → Job search and
 * Find jobs: it's unofficial, and the user chooses it on their own
 * responsibility. Until "I understand" is ticked, the BA isn't searched;
 * after that the note stays, without the box.
 */
export function ArbeitsagenturNote({ accepted, onAccept, className }: { accepted: boolean; onAccept: () => Promise<boolean>; className?: string }) {
  const [saving, setSaving] = useState(false);
  const accept = async () => {
    setSaving(true);
    // Stays ticked once saved; the page then shows the note without the box.
    if (!(await onAccept())) setSaving(false);
  };
  return (
    <div role="note" className={cn("flex flex-col gap-3 rounded-card bg-warning-surface px-4 py-3 text-meta text-warning", className)}>
      <p>
        {ARBEITSAGENTUR_NOTE}{" "}
        <a href={ARBEITSAGENTUR_TERMS_URL} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
          The BA&apos;s terms of use
          <span className="sr-only"> (German, opens in a new tab)</span>
        </a>
      </p>
      {!accepted && (
        <Checkbox
          label={<span className="font-medium text-ink">I understand, and choose this source myself</span>}
          checked={saving}
          disabled={saving}
          onChange={(event) => {
            if (event.target.checked) void accept();
          }}
        />
      )}
    </div>
  );
}
