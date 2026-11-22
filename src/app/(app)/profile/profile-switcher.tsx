"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { levelRange } from "@/lib/profile-levels";

import { LevelsPicker, type LevelChoice } from "./levels-field";
import { deleteProfileAction, newProfile, renameProfileAction } from "./profiles-actions";

export type ProfileChoice = { id: string; name: string };

const START_OPTIONS = [
  { value: "empty", label: "Empty" },
  { value: "copy", label: "A copy" },
  { value: "file", label: "A resume file" },
] as const;
type Start = (typeof START_OPTIONS)[number]["value"];

/**
 * The open profile, and switching, making, renaming and deleting profiles
 * (E24-2), at the top of Profile and Base resume. Picking one opens it on
 * this page; both pages then open it until another is picked.
 */
export function ProfileSwitcher({ profiles, current, path }: { profiles: ProfileChoice[]; current: ProfileChoice; path: "/profile" | "/resume" }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"new" | "rename" | "delete" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const only = profiles.length <= 1;

  const remove = async () => {
    const result = toastResult(await deleteProfileAction({ id: current.id }));
    if (result.ok) router.push(`${path}?profile=${result.data.id}`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} variant="secondary" className="max-w-[320px]">
            <span className="text-muted">Profile:</span> <span className="truncate">{current.name}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Your profiles</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => id !== current.id && router.push(`${path}?profile=${id}`)}>
            {profiles.map((profile) => (
              <DropdownMenuRadioItem key={profile.id} value={profile.id}>
                {profile.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <div role="separator" className="my-1 h-px bg-line" />
          <DropdownMenuItem onSelect={() => setDialog("new")}>New profile…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("rename")}>Rename “{current.name}”…</DropdownMenuItem>
          <DropdownMenuItem disabled={only} onSelect={() => setDialog("delete")}>
            Delete “{current.name}”…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "new" && <NewProfileDialog profiles={profiles} current={current} onClose={() => setDialog(null)} path={path} />}
      {dialog === "rename" && <RenameDialog current={current} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Delete “${current.name}”?`}
        description="Its sections, its Base resume and its settings go with it. The shared basics, languages and facts about me stay, and applications keep their own documents."
        confirmLabel="Delete profile"
        onConfirm={() => void remove()}
        returnFocusTo={trigger}
      />
    </>
  );
}

/** A dialog with a form, a title and its buttons. */
function FormDialog({ title, onClose, onSubmit, submit, busy, children }: { title: string; onClose: () => void; onSubmit: () => void; submit: string; busy: boolean; children: ReactNode }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-y-auto rounded-dialog border border-line-popover bg-card p-6 shadow-menu focus:outline-none"
        >
          <Dialog.Title className="font-serif text-[22px] leading-tight">{title}</Dialog.Title>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              if (!busy) onSubmit();
            }}
          >
            {children}
            <div className="flex flex-wrap justify-end gap-2.5">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" aria-disabled={busy || undefined}>
                {submit}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** New profile (M1b): empty, a copy of one, or read from a resume file. Also opened from the sidebar's "+" (E27-5). */
export function NewProfileDialog({
  profiles,
  current,
  path = "/profile",
  onClose,
}: {
  profiles: ProfileChoice[];
  current: ProfileChoice;
  path?: "/profile" | "/resume";
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("empty");
  const [from, setFrom] = useState(current.id);
  const [levels, setLevels] = useState<LevelChoice>({ from: "", to: "" });
  const range = levelRange(levels.from, levels.to);
  const [busy, setBusy] = useState(false);
  const startId = useId();

  const make = async () => {
    if (start === "empty" && !range) return void toast("Choose the levels this profile is for.");
    setBusy(true);
    const result = toastResult(await newProfile(start === "copy" ? { start, name, from } : start === "empty" ? { start, name, levels: range! } : { start, name }));
    setBusy(false);
    if (!result.ok) return;
    onClose();
    router.push(start === "file" ? `/profile/import?profile=${result.data.id}` : `${path}?profile=${result.data.id}`);
  };

  return (
    <FormDialog title="New profile" onClose={onClose} onSubmit={() => void make()} submit={busy ? "Making…" : "Make profile"} busy={busy}>
      <Input label="Name" hint="What you call it, such as Backend or Frontend." value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus required />
      <div className="flex flex-col gap-2">
        <span id={startId} className="text-label font-medium">
          Start from
        </span>
        <SegmentedControl<Start> aria-labelledby={startId} options={[...START_OPTIONS]} value={start} onValueChange={setStart} />
        <p className="text-label text-pretty text-muted">
          {start === "empty"
            ? "Only the shared basics, languages and facts about me. You fill in the rest."
            : start === "copy"
              ? "Everything in the profile you pick, its levels too, which you can then change without touching the other."
              : "You choose the file next; Dossier reads it into the new profile, guesses its levels, and you check what it found before anything is saved."}
        </p>
      </div>
      {start === "empty" && (
        <div className="flex flex-col gap-2">
          <span className="text-label font-medium">The levels it&apos;s for</span>
          <LevelsPicker value={levels} onChange={setLevels} />
        </div>
      )}
      {start === "copy" && (
        <Select label="Copy of" value={from} onChange={(event) => setFrom(event.target.value)}>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </Select>
      )}
    </FormDialog>
  );
}

function RenameDialog({ current, onClose }: { current: ProfileChoice; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(current.name);
  const [busy, setBusy] = useState(false);
  const rename = async () => {
    setBusy(true);
    const result = toastResult(await renameProfileAction({ id: current.id, name }));
    setBusy(false);
    if (!result.ok) return;
    onClose();
    router.refresh();
  };
  return (
    <FormDialog title="Rename profile" onClose={onClose} onSubmit={() => void rename()} submit={busy ? "Saving…" : "Save"} busy={busy}>
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus required />
    </FormDialog>
  );
}
