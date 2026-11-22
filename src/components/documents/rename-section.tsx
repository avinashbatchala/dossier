"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The form that renames a section's heading on one resume (#339). `name` is what it's called now, `usual` what it's called elsewhere. */
export function RenameForm({ name, usual, onSave, onCancel }: { name: string; usual: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(title.trim() === usual ? "" : title);
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-wrap items-center gap-1.5 py-1 pl-8">
      <Input className="min-w-0 flex-1" aria-label={`New heading for ${usual}`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} autoFocus />
      <Button type="submit" size="sm">
        Save
      </Button>
      <Button variant="text" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
