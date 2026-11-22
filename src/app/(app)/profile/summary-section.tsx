"use client";

import { useTrackSave } from "@/components/save-tracker";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import type { Basics } from "@/lib/profile";

import { saveBasics } from "./actions";
import { useProfileId } from "./profile-id";

/**
 * Headline and summary (E33-1, PR1): this profile's own, apart from Basics,
 * which every profile shares. Autosaved as you type.
 */
export function SummarySection({ basics, onChange }: { basics: Basics; onChange: (basics: Basics) => void }) {
  const profileId = useProfileId();
  const track = useTrackSave();
  const { flush } = useAutosave(basics, (value) => track(saveBasics({ ...value, profileId })));

  return (
    <Card className="flex flex-col gap-5">
      <Input
        label="Headline"
        hint="The title under your name, for this profile."
        placeholder="Senior Product Designer"
        value={basics.headline}
        onChange={(event) => onChange({ ...basics, headline: event.target.value })}
        onBlur={flush}
      />
      <Textarea
        label="A few lines about you"
        placeholder="What you do, what you're good at, what you're looking for."
        rows={6}
        value={basics.summary}
        onChange={(event) => onChange({ ...basics, summary: event.target.value })}
        onBlur={flush}
      />
    </Card>
  );
}
