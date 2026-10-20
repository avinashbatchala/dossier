import type { Metadata } from "next";

import { isAiConfigured } from "@/lib/ai/config";
import { DEMO_POSTING } from "@/lib/demo-profile";
import { postingText } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";

import { NewApplication } from "./new-application";

export const metadata: Metadata = { title: "New application" };

/** Posting → details and match → tailored documents (PRD §6.4). Nothing is created until the last step. */
export default async function NewApplicationPage({ searchParams }: PageProps<"/new">) {
  const { fresh, posting } = await searchParams;
  const [aiReady, applications, settings, fromFindJobs] = await Promise.all([
    isAiConfigured(),
    prisma.application.count({ where: { awaitingReview: false } }),
    loadSettings(),
    // "Start application" on Find jobs (E14-8).
    typeof posting === "string" ? prisma.posting.findUnique({ where: { id: posting } }) : null,
  ]);
  return (
    <NewApplication
      aiReady={aiReady}
      defaultTone={settings.defaultTone}
      fresh={fresh !== undefined}
      fromPosting={
        fromFindJobs && { id: fromFindJobs.id, text: postingText(fromFindJobs), url: fromFindJobs.url, complete: fromFindJobs.complete }
      }
      // A first-run helper: only until the first application exists (E7-1).
      samplePosting={applications === 0 ? DEMO_POSTING : null}
    />
  );
}
