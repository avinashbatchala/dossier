import type { Metadata } from "next";

import { isAiConfigured } from "@/lib/ai/config";
import { findUnfinishedJobs } from "@/lib/jobs/runner";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { placeOf } from "@/lib/startups/place";
import { STARTUPS_JOB_KEY } from "@/lib/startups/refresh";
import { listStartups } from "@/lib/startups/store";
import { startupFilterFromParams } from "@/lib/startups/types";

import { StartupsScreen } from "./startups-screen";

export const metadata: Metadata = { title: "Startups" };

/** Opening the screen counts as using it for this long, so the daily refresh keeps going (#222). */
const VIEW_MARK_MS = 60 * 60 * 1000;

/**
 * Startups that are hiring (#222): YC startups' job posts and Hacker News'
 * "Who is hiring?", ranked against the profile, with the addresses they
 * publish for applications.
 */
export default async function StartupsPage({ searchParams }: PageProps<"/startups">) {
  const filter = startupFilterFromParams(await searchParams);
  const [profile, settings, aiReady, [running]] = await Promise.all([loadProfile(), loadSettings(), isAiConfigured(), findUnfinishedJobs(STARTUPS_JOB_KEY)]);
  const place = placeOf(profile.basics);
  const now = new Date();
  if (!settings.startupsViewedAt || now.getTime() - Date.parse(settings.startupsViewedAt) > VIEW_MARK_MS) {
    await saveSettings({ startupsViewedAt: now.toISOString() });
  }
  return (
    <StartupsScreen
      filter={filter}
      list={await listStartups(filter, place)}
      lastRefresh={settings.startupsLastRefresh}
      refreshJobId={running?.id ?? null}
      city={place.city}
      country={place.country ? place.countryName : ""}
      headline={profile.basics.headline.trim()}
      aiReady={aiReady}
      today={now.toISOString()}
    />
  );
}
