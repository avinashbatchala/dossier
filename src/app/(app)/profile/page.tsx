import type { Metadata } from "next";

import { loadProfile } from "@/lib/profile-data";
import { COUNTRIES } from "@/lib/job-search/countries";
import { loadDemand } from "@/lib/demand";
import { loadRoleUsage } from "@/lib/role-usage";
import { listProfiles, loadProfileLevels, loadProfileSettings, loadProfileWorkplace, openProfileId } from "@/lib/profiles";

import { ProfileEditor } from "./profile-editor";
import { sectionFromParam } from "./sections";

export const metadata: Metadata = { title: "Profile" };

/**
 * The profile editor; the current section is in `?section=` (E4-1), and the
 * profile in `?profile=`, or else the one last opened (E24-2).
 */
export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const { section, profile: asked } = await searchParams;
  const profileId = await openProfileId(typeof asked === "string" ? asked : null);
  const [profile, settings, profiles, levels, workplace, roleUsage, demand] = await Promise.all([
    loadProfile(profileId),
    loadProfileSettings(profileId),
    listProfiles(),
    loadProfileLevels(profileId),
    loadProfileWorkplace(profileId),
    loadRoleUsage(profileId),
    loadDemand(profileId),
  ]);
  return (
    <ProfileEditor
      key={profileId}
      profileId={profileId}
      profiles={profiles}
      levels={levels}
      workplace={workplace}
      countries={COUNTRIES}
      initial={profile}
      section={sectionFromParam(section, profile.customSections)}
      order={{ experience: settings.experienceOrder, projects: settings.projectOrder, education: settings.educationOrder, skills: settings.skillOrder }}
      sections={settings.resumeSections}
      roleUsage={roleUsage}
      demand={demand}
    />
  );
}
