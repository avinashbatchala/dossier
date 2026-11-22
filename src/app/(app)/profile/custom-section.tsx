"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { CustomSectionFormat } from "@/generated/prisma/enums";
import { useAutosave } from "@/hooks/use-autosave";
import { citationExcerpt } from "@/lib/citation";
import { CUSTOM_SECTION_COUNTS_AS, CUSTOM_SECTION_FORMATS, formatDateRange, type CustomItem, type CustomSection } from "@/lib/profile";

import { createCustomItem, deleteCustomSection, removeCustomItem, reorderCustomItems, restoreCustomItem, restoreCustomSection, saveCustomItem, saveCustomSection } from "./actions";
import { EntryList } from "./entry-list";
import { MonthYearField } from "./month-year-field";
import type { UpdateProfile } from "./skills-section";
import { useProfileId } from "./profile-id";

const optional = (label: string) => (
  <>
    {label} <span className="font-normal text-muted">(optional)</span>
  </>
);

/** The fields of an open item, the ones its section's format shows, autosaved as you type. */
function CustomItemForm({
  sectionId,
  format,
  entry,
  onChange,
  autoFocus,
}: {
  sectionId: string;
  format: CustomSectionFormat;
  entry: CustomItem;
  onChange: (entry: CustomItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveCustomItem({ ...value, sectionId })));
  const set = (change: Partial<CustomItem>) => onChange({ ...entry, ...change });
  const link = (
    <Input
      className="col-span-2"
      label={optional("Link")}
      placeholder="example.org/award"
      hint="On a PDF, the link can be clicked."
      value={entry.link}
      onChange={(event) => set({ link: event.target.value })}
    />
  );

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      {format === "ENTRIES" && (
        <>
          <Input className="col-span-2" label="Title" placeholder="Mentor" value={entry.title} onChange={(event) => set({ title: event.target.value })} autoFocus={autoFocus} />
          <Input className="col-span-2" label={optional("Where or with whom")} placeholder="Code Club" value={entry.subtitle} onChange={(event) => set({ subtitle: event.target.value })} />
          <MonthYearField label="Started" value={{ month: entry.startMonth, year: entry.startYear }} onChange={({ month, year }) => set({ startMonth: month, startYear: year })} />
          <div className="flex flex-col gap-2.5">
            <MonthYearField label="Finished" value={{ month: entry.endMonth, year: entry.endYear }} onChange={({ month, year }) => set({ endMonth: month, endYear: year })} disabled={entry.current} />
            <Checkbox label="Still going" checked={entry.current} onChange={(event) => set({ current: event.target.checked })} />
          </div>
          <Textarea
            className="col-span-2"
            label={optional("Details")}
            hint="One bullet per line."
            placeholder="Taught 40 pupils to build their first website"
            rows={4}
            value={entry.details}
            onChange={(event) => set({ details: event.target.value })}
          />
          {link}
        </>
      )}
      {format === "LINES" && (
        <>
          <Textarea
            className="col-span-2"
            label="Text"
            hint="As long as you like. Write **bold** or *italic* with asterisks."
            placeholder="Best Paper Award, CHI 2023"
            rows={3}
            value={entry.title}
            onChange={(event) => set({ title: event.target.value })}
            autoFocus={autoFocus}
          />
          {link}
        </>
      )}
      {format === "INLINE" && <Input className="col-span-2" label="Item" placeholder="Climbing" value={entry.title} onChange={(event) => set({ title: event.target.value })} autoFocus={autoFocus} />}
      <Checkbox
        className="col-span-2"
        label="Show on resumes"
        hint="Off keeps it in your profile, but leaves it off every resume and out of what the AI reads."
        checked={entry.onResumes}
        onChange={(event) => set({ onResumes: event.target.checked })}
      />
    </div>
  );
}

/**
 * The page of a section the user made (#298): its name, its format and its
 * items, which go on resumes as written, and deleting it, with Undo in the toast.
 */
export function CustomSectionEditor({
  section,
  update,
  onDeleted,
  onRestored,
}: {
  section: CustomSection;
  update: UpdateProfile;
  onDeleted: (section: CustomSection) => void;
  onRestored: (section: CustomSection) => void;
}) {
  const profileId = useProfileId();
  const track = useTrackSave();
  const [title, setTitle] = useState(section.title);
  const [quick, setQuick] = useState("");
  const { flush } = useAutosave({ id: section.id, title, format: section.format, countsAs: section.countsAs }, (value) => track(saveCustomSection(value)));
  const setSection = (change: (current: CustomSection) => CustomSection) =>
    update((current) => ({ ...current, customSections: current.customSections.map((entry) => (entry.id === section.id ? change(entry) : entry)) }));
  const setItems = (change: (items: CustomItem[]) => CustomItem[]) => setSection((current) => ({ ...current, items: change(current.items) }));
  const format = CUSTOM_SECTION_FORMATS.find((entry) => entry.value === section.format)!;
  const countsAs = CUSTOM_SECTION_COUNTS_AS.find((entry) => entry.value === section.countsAs) ?? CUSTOM_SECTION_COUNTS_AS[2];

  const remove = async () => {
    flush();
    if (!toastResult(await track(deleteCustomSection({ id: section.id }))).ok) return;
    onDeleted(section);
    toast(`Deleted “${section.title}”.`, {
      action: {
        label: "Undo",
        onClick: async () => {
          if (!toastResult(await restoreCustomSection({ ...section, profileId })).ok) return;
          onRestored(section);
          toast(`Put back “${section.title}”.`);
        },
      },
    });
  };

  /** Inline items are a word or two each: type one and press Enter, as with skills. */
  const addQuick = async () => {
    const name = quick.trim();
    if (!name) return;
    setQuick("");
    const result = await track(createCustomItem({ sectionId: section.id, title: name }));
    if (!result.ok) return toast(result.error);
    setItems((current) => [...current, result.data]);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-[18px]" onBlur={flush}>
        <Input
          label="Section name"
          hint="Resumes print it as you write it here."
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (event.target.value.trim()) setSection((current) => ({ ...current, title: event.target.value }));
          }}
        />
        <div className="flex flex-col gap-2">
          <span id={`format-${section.id}`} className="text-label font-medium">
            How it looks on resumes
          </span>
          <SegmentedControl
            aria-labelledby={`format-${section.id}`}
            options={CUSTOM_SECTION_FORMATS.map(({ value, label }) => ({ value, label }))}
            value={section.format}
            onValueChange={(value) => setSection((current) => ({ ...current, format: value }))}
          />
          <p className="text-label text-muted">{format.hint} Switching keeps everything you&apos;ve written here.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span id={`counts-as-${section.id}`} className="text-label font-medium">
            Counts as
          </span>
          <SegmentedControl
            aria-labelledby={`counts-as-${section.id}`}
            options={CUSTOM_SECTION_COUNTS_AS.map(({ value, label }) => ({ value, label }))}
            value={section.countsAs}
            onValueChange={(value) => setSection((current) => ({ ...current, countsAs: value }))}
          />
          <p className="text-label text-muted">{countsAs.hint} Scoring a posting weighs it there.</p>
        </div>
      </div>
      {section.format === "INLINE" && (
        <Input
          label="Add an item"
          hint="Type one and press Enter."
          placeholder="Climbing"
          value={quick}
          onChange={(event) => setQuick(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void addQuick();
          }}
        />
      )}
      <EntryList
        items={section.items}
        setItems={setItems}
        addLabel="Add an item"
        ordering={{ mode: "manual", save: (ids) => reorderCustomItems({ sectionId: section.id, ids }) }}
        summary={(entry) => ({
          title: citationExcerpt(entry.title) || (entry.details.trim() ? section.title : "New item"),
          subtitle: section.format === "ENTRIES" ? entry.subtitle.trim() : section.format === "LINES" ? entry.link.trim() : "Inline",
          meta: entry.onResumes ? (section.format === "ENTRIES" && formatDateRange(entry)) || undefined : "Not on resumes",
        })}
        create={() => createCustomItem({ sectionId: section.id })}
        remove={(entry) => removeCustomItem({ id: entry.id })}
        restore={(entry) => restoreCustomItem({ ...entry, sectionId: section.id })}
        renderForm={(entry, { onChange, autoFocus }) => (
          <CustomItemForm sectionId={section.id} format={section.format} entry={entry} onChange={onChange} autoFocus={autoFocus} />
        )}
      />
      <Button variant="danger-text" size="sm" className="self-start" onClick={() => void remove()}>
        Delete this section
      </Button>
    </div>
  );
}

