"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { archiveApplication, DeleteApplicationDialog } from "@/components/application-lifecycle";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

/** The application's "⋯" menu (E9-5): Notes on narrow windows (E30-3), Archive or Unarchive, and Delete. */
export function ApplicationMenu({ id, archived, onNotes }: { id: string; archived: boolean; onNotes?: () => void }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label="More actions"
          className="grid size-[38px] place-items-center rounded-control border border-line-control text-muted hover:border-line-strong hover:text-ink data-[state=open]:border-primary data-[state=open]:text-ink"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ⋯
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-[180px]">
          {onNotes && (
            // Its tab is hidden on narrow windows; a media query, since the menu isn't inside the page.
            <DropdownMenuItem onSelect={onNotes} className="min-[1500px]:hidden">
              Notes
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void archiveApplication(id, !archived)}>{archived ? "Unarchive" : "Archive"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)} className="text-danger data-highlighted:text-error-strong">
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteApplicationDialog id={id} open={deleting} onOpenChange={setDeleting} onDeleted={() => router.push("/applications")} returnFocusTo={trigger} />
    </>
  );
}
