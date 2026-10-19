"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action } from "@/lib/action";
import { saveSettings } from "@/lib/settings-data";

/** "Not now" on the sidebar's update notice: hidden until a newer release than this one comes out. */
export const dismissUpdate = action(z.object({ version: z.string().trim().min(1).max(40) }), async ({ version }) => {
  await saveSettings({ updateDismissed: version });
  revalidatePath("/", "layout");
  return null;
});
