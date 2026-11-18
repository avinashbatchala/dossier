import { Bell, Bot, Database, FileText, Gauge, Info, Mail, Plug, Search, Sparkles, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/cn";
import { problemsBanner, type SectionTone, type SettingsStatus } from "@/lib/settings-status";

import { SETTINGS_GROUPS, settingsLabel, settingsSectionHref, type SettingsSectionId } from "./sections";

const ICONS: Record<SettingsSectionId, LucideIcon> = {
  ai: Sparkles,
  documents: FileText,
  scoring: Gauge,
  jobs: Search,
  agent: Bot,
  google: Mail,
  notifications: Bell,
  connector: Plug,
  data: Database,
  about: Info,
};

/** A card's tag (E34-2): On, Needs a look or Off. */
const TAGS: Record<SectionTone, { label: string; className: string }> = {
  on: { label: "On", className: "bg-success/14 text-success" },
  look: { label: "Needs a look", className: "bg-warning/14 text-warning" },
  off: { label: "Off", className: "bg-track text-muted" },
};

/**
 * The Settings overview (E34-2, design 9b): what needs a look first, with
 * its fix, then a card per section in four groups. Each card is the link
 * to its section.
 */
export function SettingsOverview({ status }: { status: SettingsStatus }) {
  const banner = problemsBanner(status);
  return (
    <div className="flex flex-col gap-7">
      {banner && (
        <section aria-label="Needs a look" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-warning-line bg-warning/10 px-5 py-4">
          <span aria-hidden="true" className="font-semibold text-warning">
            !
          </span>
          <p className="min-w-0 flex-[1_1_320px] text-sm text-pretty">
            <span className="font-medium">{banner.title}</span> {banner.summary}
          </p>
          <Link href={settingsSectionHref(banner.fix.section)} className="flex-none rounded-control border border-line-strong bg-card px-3 py-1.5 text-sm font-medium text-ink hover:bg-hover hover:text-ink">
            {banner.fix.label}
          </Link>
        </section>
      )}
      {SETTINGS_GROUPS.map((group) => (
        <section key={group.label} aria-label={group.label} className="flex flex-col gap-2.5">
          <h2 className="text-label text-muted">{group.label}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1500px]:grid-cols-4">
            {group.sections.map((id) => {
              const stands = status[id];
              const Icon = ICONS[id];
              return (
                <li key={id} className="flex">
                  <Link
                    href={settingsSectionHref(id)}
                    className={cn(
                      "flex w-full flex-col gap-1.5 rounded-[12px] border bg-card px-[18px] py-4 text-ink hover:bg-hover hover:text-ink",
                      stands.tone === "look" ? "border-warning-line" : "border-line-card",
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon size={16} aria-hidden="true" className="flex-none text-muted" />
                      <span className="min-w-0 flex-1 text-[14.5px] font-medium">{settingsLabel(id)}</span>{" "}
                      <span className={cn("flex-none rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-medium", TAGS[stands.tone].className)}>{TAGS[stands.tone].label}</span>
                    </span>{" "}
                    <span className="text-meta text-pretty">{stands.state}</span>{" "}
                    <span className="text-label text-pretty text-muted">{stands.meta}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
