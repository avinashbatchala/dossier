import type { Metadata } from "next";

import { isAiConfigured, isAiUsable } from "@/lib/ai/config";
import { handsOffToClaude } from "@/lib/connector/handoff";
import { DEMO_POSTING } from "@/lib/demo-profile";
import { updatedAgo } from "@/lib/applications-list";
import { postingText } from "@/lib/job-search/search";
import { startingPoints } from "@/lib/library";
import { bestProfileFor } from "@/lib/posting-scores";
import { prisma } from "@/lib/prisma";
import { listProfiles, openProfileId } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { getStartup, startupPostingText } from "@/lib/startups/store";

import { roleLabel } from "../applications/[id]/meta";
import { NewApplication } from "./new-application";

export const metadata: Metadata = { title: "New application" };

/** Posting → details and match → tailored documents (PRD §6.4). Nothing is created until the last step. */
export default async function NewApplicationPage({ searchParams }: PageProps<"/new">) {
  const { fresh, posting, startup: startupId } = await searchParams;
  const [aiReady, writeInClaude, applications, settings, fromFindJobs, startup, profiles, defaultProfileId, points, experience] = await Promise.all([
    isAiConfigured(),
    isAiUsable().then(handsOffToClaude),
    prisma.application.count({ where: { awaitingReview: false } }),
    loadSettings(),
    // "Start application" on Find jobs (E14-8).
    typeof posting === "string" ? prisma.posting.findUnique({ where: { id: posting } }) : null,
    // "Write to them" on Startups (#222): what's known about the startup, without its addresses.
    typeof startupId === "string" ? getStartup(startupId) : null,
    // Which profile it's made from (E24-6): the one last opened, unless the user picks another.
    listProfiles(),
    openProfileId(),
    // "Or start from one you saved" (E31-2).
    startingPoints(),
    // Each profile's roles, for "Where you used it" on a gap (E30-5).
    prisma.experience.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }], select: { id: true, profileId: true, company: true, role: true, startYear: true, endYear: true, current: true } }),
  ]);
  const roles: Record<string, { id: string; label: string }[]> = {};
  for (const entry of experience) (roles[entry.profileId] ??= []).push({ id: entry.id, label: roleLabel(entry) });
  // From Positions, the profile that scored it best starts chosen (M8); the user can change it.
  const best = fromFindJobs ? await bestProfileFor(fromFindJobs) : null;
  return (
    <NewApplication
      aiReady={aiReady}
      writeInClaude={writeInClaude}
      defaultTone={settings.defaultTone}
      defaultWrite={settings.documentsToWrite}
      profiles={profiles}
      // "Write to them" starts from the profile the startup fits best.
      defaultProfileId={best ?? startup?.profileId ?? defaultProfileId}
      fresh={fresh !== undefined}
      fromPosting={
        fromFindJobs
          ? { id: fromFindJobs.id, text: postingText(fromFindJobs), url: fromFindJobs.url, complete: fromFindJobs.complete }
          : startup && {
              id: null,
              startup: { id: startup.id, company: startup.company },
              text: startupPostingText(startup),
              url: startup.links[0]?.url ?? startup.website,
              complete: true,
            }
      }
      roles={roles}
      docLanguage={settings.docLanguage}
      startFrom={points.map(({ at, ...point }) => ({ ...point, when: `${point.from === "saved" ? "Saved" : "Agent"} · ${updatedAgo(at).toLowerCase()}` }))}
      // A first-run helper: only until the first application exists (E7-1).
      samplePosting={applications === 0 ? DEMO_POSTING : null}
    />
  );
}
