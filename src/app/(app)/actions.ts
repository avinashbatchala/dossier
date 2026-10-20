"use server";

import { z } from "zod";

import { revalidatePath } from "next/cache";

import { action, ActionError } from "@/lib/action";
import { env } from "@/lib/env";
import { saveSettings } from "@/lib/settings-data";
import { saveUsagePingChoice } from "@/lib/usage-ping";

/** Remembers the dashboard's period (E9-8), for the next visit. */
export const rememberDashboardPeriod = action(z.object({ period: z.enum(["30d", "90d", "all"]) }), async ({ period }) => {
  await saveSettings({ dashboardPeriod: period });
  return null;
});

/** Days without news before "Worth a look" suggests a follow-up (E9-9). */
export const rememberQuietDays = action(z.object({ days: z.number().int().min(1).max(60) }), async ({ days }) => {
  await saveSettings({ quietDays: days });
  return null;
});

/**
 * The answer to the usage ping question (#172), from the dialog after
 * sign-in or the switch in Settings → About. Closing the dialog is a no.
 * While DOSSIER_TELEMETRY is set, it decides, and this changes nothing.
 */
export const chooseUsagePing = action(z.object({ send: z.boolean() }), async ({ send }) => {
  if (env.DOSSIER_TELEMETRY) {
    throw new ActionError(`DOSSIER_TELEMETRY=${env.DOSSIER_TELEMETRY} is set on the server, so it decides. Change it there.`);
  }
  await saveUsagePingChoice(send ? "on" : "off");
  revalidatePath("/", "layout");
  return null;
});
