import type { Metadata } from "next";

import { isAiConfigured, loadAiConfig } from "@/lib/ai/config";
import { jobRetentionLabel } from "@/lib/settings";
import { listProfiles, loadProfileLevels, openProfileId } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";

import { ProfileImport } from "./profile-import";

export const metadata: Metadata = { title: "Import from a resume" };

/** Starts the profile from an existing resume file (E4-10, PRO-12); `?job=` follows a reading in progress. */
export default async function ProfileImportPage({ searchParams }: PageProps<"/profile/import">) {
  const { job, profile: asked } = await searchParams;
  // Into the profile asked for, or the one last opened (E24-2).
  const profileId = await openProfileId(typeof asked === "string" ? asked : null);
  const [aiReady, ai, settings, profiles, levels] = await Promise.all([isAiConfigured(), loadAiConfig(), loadSettings(), listProfiles(), loadProfileLevels(profileId)]);
  return (
    <ProfileImport
      profileId={profileId}
      profileName={profiles.length > 1 ? profiles.find((entry) => entry.id === profileId)?.name : undefined}
      needsLevels={!levels}
      aiReady={aiReady}
      provider={ai.provider}
      initialJobId={typeof job === "string" ? job : null}
      keptFor={jobRetentionLabel(settings.jobRetentionHours)}
    />
  );
}
