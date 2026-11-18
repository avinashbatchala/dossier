"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import { formatDateRange, type EducationItem, type EntryOrder, type ProfileData } from "@/lib/profile";

import { createEducation, removeEducation, reorderEntries, restoreEducation, saveEducation, sortEntriesByDate } from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import { useTrackSave } from "@/components/save-tracker";
import type { UpdateProfile } from "./skills-section";
import { useProfileId } from "./profile-id";

function EducationForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: EducationItem;
  onChange: (entry: EducationItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveEducation(value)));
  const set = (change: Partial<EducationItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Degree or course"
        placeholder="BSc Computer Science"
        value={entry.degree}
        onChange={(event) => set({ degree: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        className="col-span-2"
        label="School"
        placeholder="Springfield University"
        value={entry.school}
        onChange={(event) => set({ school: event.target.value })}
      />
      <MonthYearField
        label="Started"
        value={{ month: entry.startMonth, year: entry.startYear }}
        onChange={({ month, year }) => set({ startMonth: month, startYear: year })}
      />
      <div className="flex flex-col gap-2.5">
        <MonthYearField
          label="Finished"
          value={{ month: entry.endMonth, year: entry.endYear }}
          onChange={({ month, year }) => set({ endMonth: month, endYear: year })}
          disabled={entry.current}
        />
        <Checkbox
          label="Still studying"
          checked={entry.current}
          onChange={(event) => set({ current: event.target.checked })}
        />
      </div>
      <Textarea
        className="col-span-2"
        label="Notes"
        placeholder="Thesis, honours, anything worth mentioning"
        rows={3}
        value={entry.notes}
        onChange={(event) => set({ notes: event.target.value })}
      />
    </div>
  );
}

/** Education (PRO-7): degrees, courses and certificates. */
export function EducationSection({ profile, update, order }: { profile: ProfileData; update: UpdateProfile; order: EntryOrder }) {
  const profileId = useProfileId();
  return (
    <EntryList
      items={profile.education}
      setItems={(change) => update((current) => ({ ...current, education: change(current.education) }))}
      addLabel="Add education"
      ordering={{
        mode: order,
        save: (ids) => reorderEntries({ profileId, section: "education", ids }),
        sortByDate: () => sortEntriesByDate({ profileId, section: "education" }),
      }}
      summary={(entry) => ({
        title: entry.degree.trim() || "New entry",
        subtitle: entry.school.trim(),
        meta: formatDateRange(entry),
      })}
      create={() => createEducation({ profileId })}
      remove={(entry) => removeEducation({ id: entry.id })}
      restore={(entry) => restoreEducation({ ...entry, profileId })}
      renderForm={(entry, { onChange, autoFocus }) => (
        <EducationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
