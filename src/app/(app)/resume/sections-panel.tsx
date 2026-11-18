"use client";

import Link from "next/link";

import { SectionOrderList, type SectionRow } from "@/components/documents/section-order-list";
import { Button, buttonClassName } from "@/components/ui/button";
import { CUSTOM_SECTION_FORMATS, type ProfileData } from "@/lib/profile";
import { resumeContent, sectionsWithContent } from "@/lib/resume-content";
import { arrangedSections, customKey, inSidebar, sectionHeading, sectionName, withHeading, withMoved, type SectionLayout } from "@/lib/resume-sections";

import { useProfileId } from "../profile/profile-id";
import { sectionHref } from "../profile/sections";

/**
 * The Sections tab of the Base resume (#297): the same order as the Profile
 * page, and which sections are on resumes. Sections are made and deleted on
 * Profile (#338). A built-in section without content isn't listed. Applications
 * that haven't got their own order follow this one, until they're sent.
 */
export function SectionsPanel({
  profile,
  includeReferences,
  sections,
  sidebar,
  onChange,
}: {
  profile: ProfileData;
  includeReferences: boolean;
  sections: SectionLayout;
  sidebar: boolean;
  onChange: (next: SectionLayout) => void;
}) {
  const profileId = useProfileId();
  const { customSections } = profile;
  const customKeys = customSections.map((section) => customKey(section.id));
  const withContent = sectionsWithContent(resumeContent(profile, { includeReferences }));
  const customOf = (key: string) => customSections.find((section) => customKey(section.id) === key);

  const row = (key: string): SectionRow => {
    const custom = customOf(key);
    const format = custom && CUSTOM_SECTION_FORMATS.find((entry) => entry.value === custom.format)!.label;
    const usual = sectionName(key, customSections);
    const name = sectionHeading(sections, key, usual);
    return {
      key,
      name,
      hint: custom && (withContent.includes(key) ? format : `${format} · nothing to show yet`),
      // A section the user made is renamed on its page, for every resume.
      usual: custom ? undefined : usual,
      inSidebar: inSidebar(key, customSections),
    };
  };
  const listed = arrangedSections(sections.order, customKeys).filter((key) => withContent.includes(key) || customKeys.includes(key));
  const on = listed.filter((key) => !sections.off.includes(key)).map(row);
  const off = listed.filter((key) => sections.off.includes(key)).map(row);

  const editLink = ({ key, name }: SectionRow) =>
    customOf(key) && (
      <Link href={sectionHref(key as `custom:${string}`, profileId)} className={buttonClassName("text", "sm")}>
        Edit <span className="sr-only">{name}</span>
      </Link>
    );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-pretty text-muted">
        Drag sections into the order you want: it&apos;s the same order as on your{" "}
        <Link href="/profile" className="font-medium text-ink underline underline-offset-2">
          Profile
        </Link>
        . Remove takes one off your resumes and keeps what&apos;s in it. New applications start like this, and resumes you&apos;ve sent stay as they were sent.
      </p>
      {on.length === 0 && off.length === 0 && <p className="text-sm text-muted">Sections show up here as you fill in your profile.</p>}
      <SectionOrderList
        rows={on}
        sidebar={sidebar}
        onMove={(keys) => onChange({ ...sections, order: withMoved(sections.order, keys) })}
        onRemove={(key) => onChange({ ...sections, off: [...sections.off, key] })}
        onRename={(key, title) => onChange(withHeading(sections, key, title))}
        actions={(entry) => editLink(entry) || null}
      />
      <Link href={sectionHref("new", profileId)} className={buttonClassName("secondary", "sm", "self-start")}>
        Add a section on your Profile
      </Link>
      {off.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-label text-muted">Not on your resumes</p>
          <ul className="flex flex-col gap-1.5">
            {off.map((entry) => (
              <li key={entry.key} className="flex flex-col rounded-control border border-dashed border-line-card py-1 pr-1.5 pl-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted">{entry.name}</span>
                  <Button variant="text" size="sm" onClick={() => onChange({ ...sections, off: sections.off.filter((key) => key !== entry.key) })}>
                    Put back <span className="sr-only">{entry.name}</span>
                  </Button>
                </div>
                {customOf(entry.key) && <div className="flex items-center gap-1">{editLink(entry)}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
