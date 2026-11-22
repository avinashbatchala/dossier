import "server-only";

import { loadJobSearchConfig } from "@/lib/job-search/config";
import { sourceInfo } from "@/lib/job-search/sources";
import { emit } from "@/lib/notifications/notify";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { portalUpdates } from "./updates";

// Notifications about the portals in use (E26-5, #420), after each catalog
// read that brought something new: "A portal you use was withdrawn" (it's
// paused) and "An update for a portal you use", each said once, by the
// withdrawal's date or the update's version (portalNotices).

/** Sends what's new about the portals switched on; returns how many messages were emitted. */
export async function notifyPortalChanges(now = new Date()): Promise<number> {
  const [config, settings] = await Promise.all([loadJobSearchConfig(), loadSettings()]);
  const inUse = config.portals.filter((portal) => portal.on);
  const updates = await portalUpdates(config);
  const notices = { ...settings.portalNotices };
  let sent = 0;
  for (const portal of inUse) {
    const name = sourceInfo(portal.id).name;
    const withdrawal = portal.withdrawal;
    if (withdrawal?.paused && notices[`withdrawn:${portal.id}`] !== withdrawal.withdrawnAt) {
      notices[`withdrawn:${portal.id}`] = withdrawal.withdrawnAt;
      sent += Number((await emit("portal.withdrawn", { portal: name, why: withdrawal.reason }, now)) > 0);
      continue;
    }
    const update = updates[portal.id];
    if (update && notices[`update:${portal.id}`] !== update.to) {
      notices[`update:${portal.id}`] = update.to;
      sent += Number((await emit("portal.updated", { portal: name, changes: [`Version ${update.from} to ${update.to}.`, ...update.changes], newHosts: update.newHosts }, now)) > 0);
    }
  }
  if (JSON.stringify(notices) !== JSON.stringify(settings.portalNotices)) await saveSettings({ portalNotices: notices });
  return sent;
}
