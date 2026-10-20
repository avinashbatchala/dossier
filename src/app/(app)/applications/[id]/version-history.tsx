"use client";

import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import type { Unit } from "@/lib/application-data";
import { formatShortDate } from "@/lib/dates";
import { DOCUMENT_LABELS } from "@/lib/file-name";

import { listVersions, loadVersion } from "./actions";

type Version = { id: string; cause: VersionCause; detail: string; createdAt: string };

/** A version as the preview shows it (E8-10). */
export type ViewedVersion = { document: DocumentKind; id: string; units: Unit[]; label: string; when: string };

/** "29 Sep, 14:05", in the browser's time zone, dated as elsewhere in the app. */
export function versionTime(iso: string): string {
  const date = new Date(iso);
  return `${formatShortDate(date)}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

/** What made a version, in words. */
export function versionLabel({ cause, detail }: Pick<Version, "cause" | "detail">): string {
  switch (cause) {
    case "WRITTEN":
      return "Written by the AI";
    case "TRIMMED":
      return "Trimmed to fit the page limit";
    case "REGENERATED":
      return detail ? `Rewrote “${detail}”` : "Rewrote a part";
    case "REFINED":
      return detail ? `Changed from the chat: “${detail}”` : "Changed from the chat";
    case "UNDONE":
      return "Undid an AI change";
    case "BEFORE_RESTORE":
      return "As it was before a restore";
    case "RESTORED":
      return detail ? `Brought back the version from ${versionTime(detail)}` : "Brought back an earlier version";
  }
}

/**
 * The versions of a tailored document (E8-10, APP-13), newest first: each AI
 * change and each restore, with when and why. Any of them can be opened in
 * the preview, and restored from there.
 */
export function VersionHistory({
  applicationId,
  document,
  onOpenChange,
  onView,
}: {
  applicationId: string;
  /** The document whose history is open; null when it's closed. */
  document: DocumentKind | null;
  onOpenChange: (open: boolean) => void;
  onView: (version: ViewedVersion) => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    if (!document) return;
    let current = true;
    void listVersions({ id: applicationId, document }).then((result) => {
      if (!current) return;
      setVersions(toastResult(result).ok && result.ok ? result.data : []);
    });
    return () => {
      current = false;
      setVersions(null);
    };
  }, [applicationId, document]);

  const view = async (version: Version) => {
    setOpening(version.id);
    const result = toastResult(await loadVersion({ id: applicationId, versionId: version.id }));
    setOpening(null);
    if (!result.ok) return;
    onView({ document: result.data.document, id: version.id, units: result.data.units, label: versionLabel(version), when: versionTime(version.createdAt) });
  };

  const name = DOCUMENT_LABELS[document ?? "RESUME"].toLowerCase();
  return (
    <Dialog.Root open={document !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content className="fixed top-0 right-0 z-50 flex h-full w-[min(400px,100vw)] flex-col gap-4 overflow-auto border-l border-line-popover bg-card p-6 shadow-menu">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="font-serif text-[22px] leading-tight">History of the {name}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted">
                A version is saved with each AI change and before each restore. Your own edits are in the current version.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded-control px-2 py-1 text-sm text-muted hover:bg-hover hover:text-ink">Close</Dialog.Close>
          </div>
          {versions === null ? (
            <p role="status" className="text-sm text-muted">
              Loading the history…
            </p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted">No versions yet. The next AI change saves the first one.</p>
          ) : (
            <ol aria-label="Versions" className="flex flex-col">
              {versions.map((version, index) => (
                <li key={version.id} className="flex items-start justify-between gap-3 border-t border-line py-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm break-words">{versionLabel(version)}</span>
                    <span className="text-meta text-muted tabular-nums">
                      {versionTime(version.createdAt)}
                      {index === 0 && " · the newest"}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Look at the version from ${versionTime(version.createdAt)}`}
                    aria-disabled={opening !== null || undefined}
                    onClick={() => void (opening ? undefined : view(version))}
                  >
                    {opening === version.id ? "Opening…" : "Look"}
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
