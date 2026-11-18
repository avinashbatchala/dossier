"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState, type ReactNode } from "react";

import { PageHeader } from "@/components/page-header";
import { SavedIndicator } from "@/components/saved-indicator";
import { buttonClassName } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import { factTexts, paidRoles, REQUIRED_BASICS, type CustomSection, type EntryOrder, type ProfileData } from "@/lib/profile";
import { withProfileRows, type SectionLayout } from "@/lib/resume-sections";
import { levelRangeLabel, type LevelRange } from "@/lib/profile-levels";
import type { Workplace } from "@/lib/profile-workplace";
import type { Country } from "@/lib/job-search/countries";
import { cn } from "@/lib/cn";
import type { RoleUsage } from "@/lib/role-usage-count";
import type { Demand } from "@/lib/demand-count";
import { Card } from "@/components/ui/card";

import { saveResumeSections } from "../resume/actions";

import { AddSectionForm } from "./add-section-form";
import { AskedForCard, useAskedFor } from "./asked-for";
import { BasicsSection } from "./basics-section";
import { CertificationsSection } from "./certifications-section";
import { CustomSectionEditor } from "./custom-section";
import { EducationSection } from "./education-section";
import { ExperienceSection } from "./experience-section";
import { FactsSection } from "./facts-section";
import { ProjectsSection } from "./projects-section";
import { PublicationsSection } from "./publications-section";
import { ReferencesSection } from "./references-section";
import { TrackSaveContext, useSaveTracker } from "@/components/save-tracker";
import { LanguagesSection, SkillsSection, type SkillOrder } from "./skills-section";
import { StrengthMeter } from "./strength-meter";
import { SummarySection } from "./summary-section";
import { SectionNav, type SectionStatus } from "./section-nav";
import { ProfileIdProvider } from "./profile-id";
import { ProfileSwitcher, type ProfileChoice } from "./profile-switcher";
import { LevelsField } from "./levels-field";
import { WorkplaceField } from "./workplace-field";
import { navSections, sectionHref, SHARED_SECTIONS, type ProfilePage, type ProfileSectionId, type SectionId } from "./sections";

/**
 * The guided profile editor (PRD §6.2). It keeps the whole profile in state,
 * so section counts update as you type; each section saves its own changes.
 */
/** How experience, projects and education are ordered (E4-9), from Settings. */
export type ProfileOrder = { experience: EntryOrder; projects: EntryOrder; education: EntryOrder; skills: SkillOrder };

export function ProfileEditor({
  profileId,
  profiles,
  levels: initialLevels,
  workplace,
  countries,
  initial,
  section,
  order,
  sections,
  roleUsage,
  demand,
}: {
  profileId: string;
  /** Every profile, for the switcher (E24-2). */
  profiles: ProfileChoice[];
  /** The levels it's for (E24-3); null until chosen. */
  levels: LevelRange | null;
  /** Where it wants to work, and whether the user has looked at it (E24-4); the countries to pick from. */
  workplace: { workplace: Workplace; seen: boolean };
  countries: readonly Country[];
  initial: ProfileData;
  section: ProfilePage;
  order: ProfileOrder;
  sections: SectionLayout;
  /** How many tailored resumes use each role (E33-2). */
  roleUsage: RoleUsage;
  /** What employers ask for (E33-3), with the skills marked "I don't have this". */
  demand: Demand & { hidden: string[]; notHere: string[] };
}) {
  const [profile, setProfile] = useState(initial);
  const [levels, setLevels] = useState(initialLevels);
  const [workplaceSeen, setWorkplaceSeen] = useState(workplace.seen);
  const onWorkplaceSeen = useCallback(() => setWorkplaceSeen(true), []);
  const [layout, setLayout] = useState(sections);
  const asked = useAskedFor({ profileId, demand, hidden: demand.hidden, notHere: demand.notHere, profile, update: setProfile });
  const saves = useSaveTracker();
  const router = useRouter();

  const nav = navSections(profile.customSections, layout.order);
  const index = nav.findIndex((entry) => entry.id === section);
  // Nothing while adding a section, and for a moment after deleting the one on screen.
  const current = nav[index];
  const previous = nav[index - 1];
  const next = nav[index + 1];
  const customOf = (id: ProfileSectionId) => profile.customSections.find((entry) => `custom:${entry.id}` === id);
  const custom = section === "new" || section === "target" ? undefined : customOf(section);

  // Profile strength counts the summary with the basics; here it has its own row.
  // How each section stands, for the nav (E33-1): ✓, ! or ·, and a note line.
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const basicsAsked = REQUIRED_BASICS.filter((field) => field !== "summary" && field !== "headline");
  const basicsFilled = basicsAsked.filter((field) => profile.basics[field].trim()).length;
  const roles = paidRoles(profile.experience);
  const bareRoles = roles.filter((role) => !role.bullets.trim()).length;
  const words = profile.basics.summary.trim() ? profile.basics.summary.trim().split(/\s+/).length : 0;
  const listed = (count: number, one: string, many: string, optional: boolean) =>
    count > 0 ? { status: "done" as const, note: plural(count, one, many) } : { status: optional ? ("empty" as const) : ("warn" as const), note: optional ? "Optional · none yet" : "None yet" };
  const standing: Record<SectionId, { status: SectionStatus; note: string }> = {
    basics: { status: basicsFilled === basicsAsked.length ? "done" : "warn", note: `${basicsFilled} of ${basicsAsked.length} filled in` },
    summary:
      profile.basics.headline.trim() && words > 0
        ? { status: "done", note: `Written · ${plural(words, "word", "words")}` }
        : { status: "warn", note: !profile.basics.headline.trim() ? "No headline yet" : "No summary yet" },
    experience:
      roles.length === 0
        ? { status: "warn", note: "No roles yet" }
        : { status: bareRoles > 0 ? "warn" : "done", note: `${plural(roles.length, "role", "roles")}${bareRoles > 0 ? ` · ${bareRoles} without lines` : ""}` },
    volunteering: listed(profile.experience.length - roles.length, "role", "roles", true),
    projects: listed(profile.projects.length, "project", "projects", true),
    education: listed(profile.education.length, "entry", "entries", false),
    certifications: listed(profile.certifications.length, "certification", "certifications", true),
    publications: listed(profile.publications.length, "publication", "publications", true),
    references: listed(profile.references.length, "reference", "references", true),
    skills: listed(profile.skills.length, "skill", "skills", false),
    languages: listed(profile.languages.length, "language", "languages", true),
    facts: { ...listed(factTexts(profile.facts).length, "fact for the AI", "facts for the AI", true) },
  };

  const body: Record<SectionId, ReactNode> = {
    basics: (
      <BasicsSection
        basics={profile.basics}
        onChange={(basics) => setProfile((current) => ({ ...current, basics }))}
        photo={profile.photo}
        onPhotoChange={(photo) => setProfile((current) => ({ ...current, photo }))}
      />
    ),
    summary: <SummarySection basics={profile.basics} onChange={(basics) => setProfile((current) => ({ ...current, basics }))} />,
    skills: <SkillsSection profile={profile} update={setProfile} order={order.skills} />,
    languages: <LanguagesSection profile={profile} update={setProfile} />,
    experience: <ExperienceSection profile={profile} update={setProfile} order={order.experience} usage={roleUsage} asked={asked} />,
    volunteering: <ExperienceSection key="volunteering" profile={profile} update={setProfile} order={order.experience} usage={roleUsage} volunteering />,
    projects: <ProjectsSection profile={profile} update={setProfile} order={order.projects} />,
    education: <EducationSection profile={profile} update={setProfile} order={order.education} />,
    certifications: <CertificationsSection profile={profile} update={setProfile} />,
    publications: <PublicationsSection profile={profile} update={setProfile} />,
    references: <ReferencesSection profile={profile} update={setProfile} />,
    facts: <FactsSection profile={profile} update={setProfile} />,
  };

  const addSection = (added: CustomSection) => setProfile((state) => ({ ...state, customSections: [...state.customSections, added] }));
  const sectionDeleted = (deleted: CustomSection) => {
    setProfile((state) => ({ ...state, customSections: state.customSections.filter((entry) => entry.id !== deleted.id) }));
    router.push(sectionHref((next ?? previous).id, profileId));
  };

  const moveRows = async (rows: string[]) => {
    const before = layout;
    const next = { ...layout, order: withProfileRows(layout.order, rows) };
    setLayout(next);
    if (!toastResult(await saves.track(saveResumeSections({ ...next, profileId }))).ok) setLayout(before);
  };

  return (
    <ProfileIdProvider value={profileId}>
    <TrackSaveContext value={saves.track}>
      <PageHeader
        title="Your profile"
        description="Everything here feeds your resumes and cover letters. Fill in what you like. You can always come back to it."
        actions={
          <>
            <SavedIndicator status={saves.status} savedAt={saves.savedAt} />
            <ProfileSwitcher profiles={profiles} current={profiles.find((entry) => entry.id === profileId) ?? { id: profileId, name: "" }} path="/profile" />
            <Link href={`/profile/import?profile=${profileId}`} className={buttonClassName("secondary")}>
              Import from a resume
            </Link>
            <Link href={`/resume?profile=${profileId}`} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              See base resume →
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-x-12 gap-y-10 px-10 pt-2 pb-20">
        <div className="flex w-full flex-col gap-6 lg:w-[340px] lg:flex-none">
          <StrengthMeter profile={profile} />
          {/* "Jobs it's for" (PR4): under the meter, folded; it says when the levels or the workplace need a look. */}
          <Link
            href={sectionHref("target", profileId)}
            aria-current={section === "target" ? "page" : undefined}
            className={cn(
              "flex flex-col gap-0.5 rounded-card border px-4 py-3 text-sm text-ink hover:border-muted hover:text-ink",
              !levels ? "border-warning-line bg-warning-surface" : "border-line-card bg-card",
              section === "target" && "border-muted font-medium",
            )}
          >
            Jobs it&apos;s for
            <span className={cn("text-xs font-normal", !levels ? "text-warning" : "text-muted")}>
              {levels ? levelRangeLabel(levels) : "Choose the levels this profile is for: scoring postings against it waits until you do"}
              {levels && !workplaceSeen && " · check where it wants to work"}
            </span>
          </Link>
          <SectionNav
            rows={nav.map((entry) => {
              const own = customOf(entry.id);
              const stands = own ? listed(own.items.length, "item", "items", true) : standing[entry.id as SectionId];
              return { ...entry, ...stands, tag: SHARED_SECTIONS.has(entry.id) ? "All profiles" : undefined };
            })}
            current={section}
            onMove={(rows) => void moveRows(rows)}
          />
          <p className="text-label text-pretty text-muted">
            Drag to reorder. Resumes use this order unless one has its own, and two-column themes keep some sections in the sidebar.
          </p>
          <AskedForCard state={asked} profile={profile} profileName={profiles.length > 1 ? (profiles.find((entry) => entry.id === profileId)?.name ?? "") : ""} />
        </div>

        <div className="flex max-w-[860px] min-w-0 flex-[999_1_420px] flex-col gap-6">
          {section === "target" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <h2 className="font-serif text-section">Jobs it&apos;s for</h2>
                <p className="text-sm text-pretty text-muted">What this profile is looking for. Scoring a posting against it weighs these, and an agent search for it starts from them.</p>
              </div>
              <Card>
                <LevelsField profileId={profileId} initial={levels} onSaved={setLevels} />
              </Card>
              <Card>
                <WorkplaceField
                  profileId={profileId}
                  initial={workplace.workplace}
                  seen={workplaceSeen}
                  city={profile.basics.city.trim()}
                  country={profile.basics.country.trim()}
                  countries={countries}
                  onSeen={onWorkplaceSeen}
                />
              </Card>
            </>
          ) : section === "new" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <h2 className="font-serif text-section">Add a section</h2>
                <p className="text-sm text-pretty text-muted">Awards, talks, memberships: anything the other sections don&apos;t cover. It goes on resumes as you write it.</p>
              </div>
              <AddSectionForm
                onAdded={(added) => {
                  addSection(added);
                  router.push(sectionHref(`custom:${added.id}`, profileId));
                }}
                onCancel={() => router.back()}
              />
            </>
          ) : (
            current && (
              <>
            <div className="flex flex-col gap-1.5">
              <h2 className="font-serif text-section">{current.title}</h2>
              <p className="text-sm text-pretty text-muted">
                {current.optional && "Optional. "}
                {current.hint}
              </p>
            </div>

            {custom ? <CustomSectionEditor key={custom.id} section={custom} update={setProfile} onDeleted={sectionDeleted} onRestored={addSection} /> : body[section as SectionId]}

            <div className="flex items-center justify-between gap-3 pt-2">
              {previous ? (
                <Link href={sectionHref(previous.id, profileId)} className={buttonClassName("text")}>
                  ← {previous.label}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link href={sectionHref(next.id, profileId)} className={buttonClassName("secondary", "md", "bg-card")}>
                  Next: {next.label} →
                </Link>
              ) : (
                <Link href="/resume" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
                  Looks good. See my resume →
                </Link>
              )}
            </div>
              </>
            )
          )}
        </div>
      </div>
    </TrackSaveContext>
    </ProfileIdProvider>
  );
}
