"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SavedIndicator } from "@/components/saved-indicator";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { BASICS_FIELDS, filledBasics, type EntryOrder, type ProfileData } from "@/lib/profile";

import { BasicsSection } from "./basics-section";
import { EducationSection } from "./education-section";
import { ExperienceSection } from "./experience-section";
import { ProjectsSection } from "./projects-section";
import { ReferencesSection } from "./references-section";
import { TrackSaveContext, useSaveTracker } from "@/components/save-tracker";
import { SkillsSection } from "./skills-section";
import { StrengthMeter } from "./strength-meter";
import { SECTIONS, sectionHref, type SectionId } from "./sections";

/**
 * The guided profile editor (PRD §6.2). It keeps the whole profile in state,
 * so section counts update as you type; each section saves its own changes.
 */
/** How experience, projects and education are ordered (E4-9), from Settings. */
export type ProfileOrder = { experience: EntryOrder; projects: EntryOrder; education: EntryOrder };

export function ProfileEditor({ initial, section, order }: { initial: ProfileData; section: SectionId; order: ProfileOrder }) {
  const [profile, setProfile] = useState(initial);
  const saves = useSaveTracker();

  const index = SECTIONS.findIndex((entry) => entry.id === section);
  const current = SECTIONS[index];
  const previous = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];

  const counts: Record<SectionId, string> = {
    basics: `${filledBasics(profile.basics)}/${BASICS_FIELDS.length}`,
    skills: String(profile.skills.length + profile.languages.length),
    experience: String(profile.experience.length),
    projects: String(profile.projects.length),
    education: String(profile.education.length),
    references: String(profile.references.length),
  };

  const body: Record<SectionId, ReactNode> = {
    basics: (
      <BasicsSection
        basics={profile.basics}
        onChange={(basics) => setProfile((current) => ({ ...current, basics }))}
      />
    ),
    skills: <SkillsSection profile={profile} update={setProfile} />,
    experience: <ExperienceSection profile={profile} update={setProfile} order={order.experience} />,
    projects: <ProjectsSection profile={profile} update={setProfile} order={order.projects} />,
    education: <EducationSection profile={profile} update={setProfile} order={order.education} />,
    references: <ReferencesSection profile={profile} update={setProfile} />,
  };

  return (
    <TrackSaveContext value={saves.track}>
      <PageHeader
        title="Your profile"
        description="Everything here feeds your resumes and cover letters. Fill in what you like. You can always come back to it."
        actions={
          <>
            <SavedIndicator status={saves.status} savedAt={saves.savedAt} />
            <Link href="/profile/import" className={buttonClassName("secondary")}>
              Import from a resume
            </Link>
            <Link href="/resume" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              See base resume →
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-x-12 gap-y-10 px-10 pt-2 pb-20">
        <div className="flex max-w-[220px] min-w-[200px] flex-[1_1_200px] flex-col gap-6">
          <StrengthMeter profile={profile} />
          <nav aria-label="Profile sections" className="flex flex-col gap-0.5">
            {SECTIONS.map((entry) => (
              <Link
                key={entry.id}
                href={sectionHref(entry.id)}
                aria-current={entry.id === section ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-control px-3 py-[9px] text-sm text-ink hover:bg-hover hover:text-ink",
                  entry.id === section && "bg-selected font-medium hover:bg-selected",
                )}
              >
                <span>{entry.label}</span>
                <span className="text-xs text-muted tabular-nums">{counts[entry.id]}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex max-w-[760px] min-w-0 flex-[999_1_420px] flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <h2 className="font-serif text-section">{current.title}</h2>
            <p className="text-sm text-pretty text-muted">{current.hint}</p>
          </div>

          {body[section]}

          <div className="flex items-center justify-between gap-3 pt-2">
            {previous ? (
              <Link href={sectionHref(previous.id)} className={buttonClassName("text")}>
                ← {previous.label}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={sectionHref(next.id)} className={buttonClassName("secondary", "md", "bg-card")}>
                Next: {next.label} →
              </Link>
            ) : (
              <Link href="/resume" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
                Looks good. See my resume →
              </Link>
            )}
          </div>
        </div>
      </div>
    </TrackSaveContext>
  );
}
