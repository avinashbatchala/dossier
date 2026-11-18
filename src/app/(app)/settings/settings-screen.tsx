"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SavedIndicator } from "@/components/saved-indicator";
import { TrackSaveContext, useSaveTracker } from "@/components/save-tracker";
import { cn } from "@/lib/cn";
import type { SectionTone, SettingsStatus } from "@/lib/settings-status";

import { SETTINGS_GROUPS, settingsLabel, settingsSectionHref, type SettingsPage } from "./sections";

/** A section's 7 px dot (E34-3): set up, needs a look, or off. */
const DOTS: Record<SectionTone, { className: string; label: string }> = {
  on: { className: "bg-success", label: "On" },
  look: { className: "bg-warning", label: "Needs a look" },
  off: { className: "bg-faint", label: "Off" },
};

/**
 * The section list (E34-3, design 9a): Overview at the top, then the
 * sections in their groups, each with a dot and a note line, in warning
 * text when it needs a look.
 */
function SettingsNav({ section, status }: { section: SettingsPage; status: SettingsStatus }) {
  return (
    <nav aria-label="Settings sections" className="flex w-full flex-col gap-4 lg:w-[300px] lg:flex-none">
      <Link
        href={settingsSectionHref("overview")}
        aria-current={section === "overview" ? "page" : undefined}
        className={cn("rounded-control px-3 py-2 text-sm text-ink hover:bg-hover hover:text-ink", section === "overview" && "bg-selected font-medium hover:bg-selected")}
      >
        Overview
      </Link>
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} role="group" aria-label={group.label} className="flex flex-col gap-0.5">
          <span aria-hidden="true" className="px-3 pb-1 text-label text-muted">
            {group.label}
          </span>
          {group.sections.map((id) => {
            const stands = status[id];
            const selected = id === section;
            return (
              <Link
                key={id}
                href={settingsSectionHref(id)}
                aria-current={selected ? "page" : undefined}
                className={cn("flex items-start gap-2.5 rounded-control px-3 py-2 text-ink hover:bg-hover hover:text-ink", selected && "bg-selected hover:bg-selected")}
              >
                <span aria-hidden="true" className={cn("mt-[7px] size-[7px] flex-none rounded-full", DOTS[stands.tone].className)} />
                <span className="flex min-w-0 flex-col">
                  <span className={cn("text-sm", selected && "font-medium")}>{settingsLabel(id)}</span>{" "}
                  <span className={cn("truncate text-xs", stands.tone === "look" ? "text-warning" : "text-muted")}>
                    <span className="sr-only">{DOTS[stands.tone].label}:</span> {stands.note}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/**
 * The Settings frame (E10-1, E34): the overview on its own, or a section
 * between the grouped list on the left and, for some, a column on the
 * right. Every control saves on its own; the header says when it's done.
 */
export function SettingsScreen({ section, status, aside, children }: { section: SettingsPage; status: SettingsStatus; aside?: ReactNode; children: ReactNode }) {
  const saves = useSaveTracker();

  return (
    <TrackSaveContext value={saves.track}>
      <PageHeader
        breadcrumb={section === "overview" ? undefined : [{ label: "Settings", href: "/settings" }, { label: settingsLabel(section) }]}
        title="Settings"
        description="It's your server, so it's your call. Every change saves on its own."
        actions={<SavedIndicator status={saves.status} savedAt={saves.savedAt} />}
      />
      {section === "overview" ? (
        <div className="px-10 pb-20">{children}</div>
      ) : (
        <div className="flex flex-wrap items-start gap-x-10 gap-y-8 px-10 pb-20 lg:flex-nowrap">
          <SettingsNav section={section} status={status} />
          {/* The column on the right sits beside the section only where both have room; below that, under it. */}
          <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-10 gap-y-8 min-[1500px]:flex-nowrap">
            <div className="@container flex max-w-[820px] min-w-0 flex-[1_1_420px] flex-col gap-5">{children}</div>
            {/* Hidden while what it holds renders nothing, such as the portal catalog before it's opened (#522). */}
            {aside && <aside className="w-full max-w-[820px] empty:hidden min-[1500px]:w-[380px] min-[1500px]:flex-none">{aside}</aside>}
          </div>
        </div>
      )}
    </TrackSaveContext>
  );
}

/** A section's title and introduction. */
export function SettingsSectionIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="font-serif text-section">{title}</h2>
      {children && <p className="text-sm text-pretty text-muted">{children}</p>}
    </div>
  );
}
