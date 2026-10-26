"use server";

import { z } from "zod";

import { StartupStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { startStartupsRefresh } from "@/lib/startups/refresh";
import { lookUpStartup, removeStartup, updateStartup } from "@/lib/startups/store";

// The Startups screen's actions (#222). Nothing here sends anything: the
// user writes to a startup from New application or their own mail.

const startupId = z.string().min(1).max(64);
const GONE = "That startup is no longer in the list. Refresh the page.";

/** "Refresh": asks both sources again, in the background; returns the job to follow. */
export const refreshStartupsNow = action(z.object({}), async () => ({ jobId: await startStartupsRefresh() }));

/** Save, Mark as contacted, Dismiss, and their Undo. */
export const setStartupStatus = action(z.object({ id: startupId, status: z.enum(StartupStatus) }), async ({ id, status }) => {
  const startup = await updateStartup(id, { status });
  if (!startup) throw new ActionError(GONE);
  return { status: startup.status };
});

/**
 * "Find addresses on their site", or with `people`, "Look for people's
 * addresses": reads the startup's own pages for the addresses it publishes.
 */
export const lookUpStartupAddresses = action(z.object({ id: startupId, people: z.boolean() }), async ({ id, people }) => {
  const startup = await lookUpStartup(id, { people });
  if (!startup) throw new ActionError(GONE);
  return startup;
});

/** Notes on a startup, kept as typed. */
export const saveStartupNotes = action(z.object({ id: startupId, notes: z.string().max(5_000) }), async ({ id, notes }) => {
  if (!(await updateStartup(id, { notes }))) throw new ActionError(GONE);
  return null;
});

/** "Remove and don't bring back": deletes it, and refreshes leave it out from now on. */
export const removeStartupForGood = action(z.object({ id: startupId }), async ({ id }, { toast }) => {
  if (!(await removeStartup(id))) throw new ActionError(GONE);
  toast("Removed. Refreshes won't bring it back.");
  return null;
});
