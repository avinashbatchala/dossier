"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action } from "@/lib/action";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { withDismissed } from "./visible";

/** "Dismiss" on the project's notice: hidden for good, and the next one shows, if any. */
export const dismissAnnouncement = action(z.object({ id: z.string().trim().min(1).max(100) }), async ({ id }) => {
  const { announcementsDismissed } = await loadSettings();
  await saveSettings({ announcementsDismissed: withDismissed(announcementsDismissed, id) });
  revalidatePath("/", "layout");
  return null;
});
