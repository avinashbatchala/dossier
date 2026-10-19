"use client";

import { useId, useState, useTransition } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { ActivityEntry } from "@/lib/activity";
import { statusInfo } from "@/lib/status";

import { addNote, deleteNote, restoreNote, updateNote } from "./actions";

/**
 * The Notes tab (E8-9, APP-14): private notes, each dated, with the
 * application's status changes and creation in one timeline, newest first.
 * Notes never go to the AI.
 */
export function NotesTab({ applicationId, activity }: { applicationId: string; activity: ActivityEntry[] }) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const draftId = useId();

  const add = () => {
    if (!draft.trim() || pending) return;
    startTransition(async () => {
      const result = await addNote({ id: applicationId, body: draft });
      if (!result.ok) return toast(result.error);
      setDraft("");
    });
  };

  const save = () => {
    if (!editing || pending) return;
    startTransition(async () => {
      const result = await updateNote({ id: applicationId, noteId: editing.id, body: editing.body });
      if (!result.ok) return toast(result.error);
      setEditing(null);
    });
  };

  // Gone at once, with Undo on the toast (as in the profile).
  const remove = (noteId: string) =>
    startTransition(async () => {
      const result = await deleteNote({ id: applicationId, noteId });
      if (!result.ok) return toast(result.error);
      toast("Note deleted.", {
        action: {
          label: "Undo",
          onClick: () => void restoreNote({ id: applicationId, ...result.data }).then((restored) => !restored.ok && toast(restored.error)),
        },
      });
    });

  return (
    <div className="@container flex flex-1 flex-col items-center gap-4 overflow-auto bg-canvas px-10 pt-11 pb-16">
      <div className="flex w-full max-w-[640px] flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-muted">
        <span>Notes and activity</span>
        <span>Private and never sent to the AI</span>
      </div>
      <div className="flex w-full max-w-[640px] flex-col gap-5 rounded-panel border border-line-card bg-card px-[30px] py-7">
        <div className="flex flex-col gap-2.5">
          <label htmlFor={draftId} className="text-[15px] font-medium">
            Add a note
          </label>
          <textarea
            id={draftId}
            rows={3}
            value={draft}
            placeholder="Who you talked to, what they said, what's next…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                add();
              }
            }}
            className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-2.5 text-sm leading-normal placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
          />
          <div className="flex justify-end">
            <Button size="sm" aria-disabled={!draft.trim() || pending || undefined} onClick={add}>
              Add note
            </Button>
          </div>
        </div>

        <ol aria-label="Notes and activity" className="flex flex-col">
          {activity.map((entry) => (
            <li key={`${entry.kind}:${entry.id}`} className="flex items-start gap-3 border-t border-line py-3.5">
              <span className="flex h-[1.4em] w-3 flex-none items-center justify-center" aria-hidden="true">
                {entry.kind === "status" ? (
                  <StatusDot status={entry.status} />
                ) : entry.kind === "created" ? (
                  <span className="size-2 rounded-full border border-faint" />
                ) : (
                  <span className="size-2 rounded-full bg-ink" />
                )}
              </span>
              {entry.kind === "note" ? (
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {editing?.id === entry.id ? (
                    <>
                      <textarea
                        aria-label="Edit note"
                        // Opened on request, so the text box takes focus.
                        autoFocus
                        rows={Math.max(3, editing.body.split("\n").length + 1)}
                        value={editing.body}
                        onChange={(event) => setEditing({ id: entry.id, body: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditing(null);
                          else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            save();
                          }
                        }}
                        className="w-full resize-y rounded-control border border-primary bg-input px-3 py-2.5 text-sm leading-normal focus-visible:outline-offset-0"
                      />
                      <div className="flex justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                        <Button size="sm" aria-disabled={pending || undefined} onClick={save}>
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm leading-[1.6] whitespace-pre-wrap">{entry.body}</p>
                      <p className="flex flex-wrap items-baseline gap-x-3 text-label text-muted">
                        <span>
                          {entry.date}
                          {entry.edited && " · edited"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Edit the note from ${entry.date}`}
                          className="hover:text-ink"
                          onClick={() => setEditing({ id: entry.id, body: entry.body })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete the note from ${entry.date}`}
                          className="text-danger hover:text-error-strong"
                          onClick={() => remove(entry.id)}
                        >
                          Delete
                        </button>
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <p className="flex min-w-0 flex-1 flex-wrap justify-between gap-x-3 text-sm">
                  <span>{entry.kind === "status" ? `Moved to ${statusInfo(entry.status).label}` : "Created"}</span>
                  <span className="text-label text-muted">{entry.date}</span>
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
