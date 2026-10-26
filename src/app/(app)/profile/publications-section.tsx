"use client";

import { useId, useLayoutEffect, useRef, type KeyboardEvent } from "react";

import { CitationText } from "@/components/citation";
import { useTrackSave } from "@/components/save-tracker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import { citationExcerpt, publicationLink, toggleMark } from "@/lib/citation";
import { cn } from "@/lib/cn";
import type { ProfileData, PublicationItem } from "@/lib/profile";
import { displayLink } from "@/lib/resume-content";

import { createPublication, removePublication, reorderPublications, restorePublication, savePublication } from "./actions";
import { EntryList } from "./entry-list";
import type { UpdateProfile } from "./skills-section";

const markButton =
  "grid size-7 place-items-center rounded-[6px] border border-line-input bg-input text-sm text-ink hover:bg-hover focus-visible:outline-offset-1";

/**
 * The citation's text box, with B and I (and Ctrl+B, Ctrl+I) for **bold**
 * and *italic*, and how it looks under it once there's text.
 */
function CitationField({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  // The selection to put back once the marked text is drawn.
  const selection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    if (!selection.current || !box.current) return;
    box.current.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [value]);

  const mark = (kind: "bold" | "italic") => {
    const field = box.current;
    if (!field) return;
    const next = toggleMark(value, { start: field.selectionStart, end: field.selectionEnd }, kind);
    selection.current = { start: next.start, end: next.end };
    field.focus();
    onChange(next.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== "b" && key !== "i") return;
    event.preventDefault();
    mark(key === "b" ? "bold" : "italic");
  };

  return (
    <div className="col-span-2 flex flex-col gap-[7px]">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="text-label font-medium text-ink">
          Citation
        </label>
        <span className="flex gap-1" role="group" aria-label="Formatting">
          <button type="button" className={cn(markButton, "font-bold")} title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => mark("bold")}>
            B
          </button>
          <button type="button" className={cn(markButton, "font-serif italic")} title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => mark("italic")}>
            I
          </button>
        </span>
      </div>
      <textarea
        ref={box}
        id={id}
        aria-describedby={`${id}-hint`}
        rows={3}
        placeholder="Doe, J., & Roe, R. (2025). A study of things. *Journal of Studies*, 12(3), 45–67."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-[11px] text-field leading-[1.6] text-ink shadow-control focus:border-primary"
      />
      <p id={`${id}-hint`} className="text-label text-muted">
        In any citation style. Select words and press B or I to set them in bold or italics, like your name or the journal:
        here they show as **bold** and *italic*.
      </p>
      {value.trim() && (
        <p className="rounded-control bg-paper px-3 py-2.5 text-sm text-pretty">
          <span className="sr-only">How it looks: </span>
          <CitationText text={value} />
        </p>
      )}
    </div>
  );
}

/** The fields of an open publication, autosaved as you type. */
function PublicationForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: PublicationItem;
  onChange: (entry: PublicationItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(savePublication(value)));
  const set = (change: Partial<PublicationItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <CitationField value={entry.citation} onChange={(citation) => set({ citation })} autoFocus={autoFocus} />
      <Input
        className="col-span-2"
        label={
          <>
            Link <span className="font-normal text-muted">(optional)</span>
          </>
        }
        placeholder="doi.org/10.1000/xyz123, or just the DOI"
        hint="A DOI on its own becomes its doi.org link. On a PDF, the link can be clicked."
        value={entry.link}
        onChange={(event) => set({ link: event.target.value })}
        onBlur={() => {
          const link = publicationLink(entry.link);
          if (link !== entry.link) set({ link });
        }}
      />
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
 * Publications (#218): citations in the user's own style, in their own
 * order. Resumes show them word for word; the AI never rewrites them.
 */
export function PublicationsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <EntryList
      items={profile.publications}
      setItems={(change) => update((current) => ({ ...current, publications: change(current.publications) }))}
      addLabel="Add a publication"
      ordering={{ mode: "manual", save: (ids) => reorderPublications({ ids }) }}
      summary={(entry) => ({
        title: citationExcerpt(entry.citation, 80) || "New publication",
        subtitle: displayLink(publicationLink(entry.link)) || (entry.citation.trim() ? "No link" : ""),
        meta: entry.onResumes ? undefined : "Not on resumes",
      })}
      create={() => createPublication({})}
      remove={(entry) => removePublication({ id: entry.id })}
      restore={(entry) => restorePublication(entry)}
      renderForm={(entry, { onChange, autoFocus }) => (
        <PublicationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
