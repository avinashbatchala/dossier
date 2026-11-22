"use client";

import { Popover } from "radix-ui";

import { SectionOrderList } from "@/components/documents/section-order-list";
import { Button } from "@/components/ui/button";
import { arrangedSections, isCustomKey, sectionHeading, withHeading, withMoved, type SectionLayout } from "@/lib/resume-sections";

/**
 * "Sections ▾" above the Resume tab's preview (#297): this resume's sections
 * to reorder, rename (#339) and remove, and what the base has that this resume
 * hasn't, to add. A section only arrives here when it's added, never on its own.
 */
export function SectionsMenu({
  sections,
  present,
  base,
  nameOf,
  isSidebar,
  sidebar,
  own,
  sent,
  canUpdate,
  onUpdate,
  onChange,
  onAdd,
  onFollowBase,
}: {
  sections: SectionLayout;
  /** The sections this resume has content for. */
  present: string[];
  /** The sections the profile has content for. */
  base: string[];
  nameOf: (key: string) => string;
  /** Whether a sidebar layout keeps the section in its sidebar. */
  isSidebar: (key: string) => boolean;
  sidebar: boolean;
  /** It has an order of its own, rather than following the base resume's. */
  own: boolean;
  /** It was sent, so nothing from the profile reaches it unless it's added here (#299). */
  sent: boolean;
  /** "Update from profile" would change what the resume shows (#301). */
  canUpdate: boolean;
  onUpdate: () => void;
  onChange: (next: SectionLayout) => void;
  onAdd: (key: string) => void;
  onFollowBase?: () => void;
}) {
  const arranged = arrangedSections(sections.order, [...new Set([...present, ...base])].filter(isCustomKey));
  const on = arranged.filter((key) => present.includes(key) && !sections.off.includes(key));
  const removed = arranged.filter((key) => present.includes(key) && sections.off.includes(key));
  const fresh = arranged.filter((key) => base.includes(key) && !present.includes(key));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="text" size="sm" className="data-[state=open]:text-ink">
          Sections
          {(fresh.length > 0 || canUpdate) && (
            <span className="text-meta text-muted">{[fresh.length > 0 && `${fresh.length} to add`, canUpdate && "update"].filter(Boolean).join(" · ")}</span>
          )}
          <span aria-hidden="true" className="text-[10px]">
            ▼
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-30 flex max-h-(--radix-popover-content-available-height) w-[min(380px,calc(100vw-16px))] flex-col gap-4 overflow-y-auto rounded-card border border-line-popover bg-card p-4 shadow-menu"
        >
          <p className="text-label text-muted">Sections on this resume</p>
          {sent && <p className="text-label text-pretty text-muted">This resume was sent, so changes to your profile don&apos;t reach it. Anything you change here does.</p>}
          {canUpdate && (
            <div className="flex flex-col items-start gap-1.5 rounded-control bg-paper p-3">
              <p className="text-label text-pretty text-muted">
                {sent
                  ? "Your profile has changed since. Updating brings in titles, dates, contact details and new items in these sections. The text on this resume stays, and nothing leaves it."
                  : "Your profile has new items for these sections. Updating adds them in your profile's own words."}
              </p>
              <Button variant="secondary" size="sm" onClick={onUpdate}>
                Update from profile
              </Button>
            </div>
          )}
          <SectionOrderList
            rows={on.map((key) => ({
              key,
              name: sectionHeading(sections, key, nameOf(key)),
              usual: nameOf(key),
              inSidebar: isSidebar(key),
            }))}
            sidebar={sidebar}
            onMove={(keys) => onChange({ ...sections, order: withMoved(sections.order, keys) })}
            onRemove={(key) => onChange({ ...sections, off: [...sections.off, key] })}
            onRename={(key, title) => onChange(withHeading(sections, key, title))}
          />
          {(fresh.length > 0 || removed.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <p className="text-label text-muted">Add from your profile</p>
              <ul className="flex flex-col gap-1.5">
                {[...fresh, ...removed].map((key) => (
                  <li key={key} className="flex items-center justify-between gap-2 rounded-control border border-dashed border-line-card py-1 pr-1.5 pl-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{nameOf(key)}</span>
                      <span className="text-xs text-muted">{fresh.includes(key) ? "Not on this resume yet" : "Removed from this resume"}</span>
                    </span>
                    <Button variant="text" size="sm" onClick={() => onAdd(key)}>
                      Add <span className="sr-only">{nameOf(key)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {own && onFollowBase && (
            <Button variant="text" size="sm" className="self-start" onClick={onFollowBase}>
              Use the base resume&apos;s order
            </Button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
