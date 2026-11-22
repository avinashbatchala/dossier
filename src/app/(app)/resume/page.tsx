import type { Metadata } from "next";

import { loadProfile } from "@/lib/profile-data";
import { listProfiles, loadProfileSettings, openProfileId } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes, loadThemeUsage } from "@/lib/theme-data";

import { ResumeWorkspace } from "./resume-workspace";

export const metadata: Metadata = { title: "Base resume" };

/** The base resume: a live preview of the profile in the chosen theme (RES-1). */
export default async function BaseResumePage({ searchParams }: PageProps<"/resume">) {
  const { panel, profile: asked } = await searchParams;
  // Each profile has its own Base resume (E24-2): the one asked for, or the one last opened.
  const profileId = await openProfileId(typeof asked === "string" ? asked : null);
  const [profiles, profile, own, themes, settings, usage] = await Promise.all([
    listProfiles(),
    loadProfile(profileId),
    loadProfileSettings(profileId),
    loadThemes(),
    loadSettings(),
    loadThemeUsage(),
  ]);
  return (
    <ResumeWorkspace
      key={profileId}
      profileId={profileId}
      profiles={profiles}
      profile={profile}
      themes={themes}
      usage={usage}
      baseThemeId={own.baseThemeId}
      paper={settings.paper}
      includeReferences={settings.includeRefs}
      language={own.resumeLanguage}
      sections={own.resumeSections}
      fitToPage={own.fitBaseResume}
      initialPanel={panel === "sections" ? "sections" : "themes"}
    />
  );
}
