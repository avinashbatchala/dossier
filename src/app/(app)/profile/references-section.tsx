"use client";

import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import type { ProfileData, ReferenceItem } from "@/lib/profile";

import { createReference, removeReference, restoreReference, saveReference } from "./actions";
import { EntryList } from "./entry-list";
import { useTrackSave } from "@/components/save-tracker";
import type { UpdateProfile } from "./skills-section";
import { useProfileId } from "./profile-id";

function ReferenceForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: ReferenceItem;
  onChange: (entry: ReferenceItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveReference(value)));
  const set = (change: Partial<ReferenceItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Name"
        placeholder="Jane Doe"
        value={entry.name}
        onChange={(event) => set({ name: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        label="How you know them"
        placeholder="Former manager"
        value={entry.relation}
        onChange={(event) => set({ relation: event.target.value })}
      />
      <Input
        label="Company"
        placeholder="Acme Inc."
        value={entry.company}
        onChange={(event) => set({ company: event.target.value })}
      />
      <Input
        label="Email"
        type="email"
        placeholder="jane.doe@example.com"
        value={entry.email}
        onChange={(event) => set({ email: event.target.value })}
      />
      <Input
        label="Phone"
        type="tel"
        placeholder="+1 555 010 0001"
        value={entry.phone}
        onChange={(event) => set({ phone: event.target.value })}
      />
    </div>
  );
}

/**
 * References (PRO-8). They stay private: documents include them only when
 * Settings allows it (E10-3), and only then are they sent to the AI (PRD §7).
 */
export function ReferencesSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  const profileId = useProfileId();
  return (
    <EntryList
      items={profile.references}
      setItems={(change) => update((current) => ({ ...current, references: change(current.references) }))}
      addLabel="Add a reference"
      summary={(entry) => ({
        title: entry.name.trim() || "New reference",
        subtitle: [entry.relation, entry.company].filter((part) => part.trim()).join(" · "),
        meta: entry.email.trim() || undefined,
      })}
      create={() => createReference({ profileId })}
      remove={(entry) => removeReference({ id: entry.id })}
      restore={(entry) => restoreReference({ ...entry, profileId })}
      renderForm={(entry, { onChange, autoFocus }) => (
        <ReferenceForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
