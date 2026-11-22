import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { PortalRegistry } from "@/components/portal-registry";
import { countAgentQueue } from "@/lib/agent/view";
import { checkAnnouncementsIfDue } from "@/lib/announcements/check";
import { currentAnnouncement } from "@/lib/announcements/visible";
import { sidebarStatuses } from "@/lib/applications-list";
import { verifySession } from "@/lib/auth/session";
import { isDesktopApp } from "@/lib/desktop";
import { inboxCount } from "@/lib/google/inbox-data";
import { portalInfo } from "@/lib/job-search/sources";
import { readCatalogIfDue } from "@/lib/portals/catalog";
import { loadInstalledPortals } from "@/lib/portals/installed";
import { loadProfileName } from "@/lib/profile-data";
import { loadSidebarProfiles } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { opensSetupGuide, setupInProgress } from "@/lib/setup-guide";
import {
  APPLICATION_SIDEBAR_COOKIE,
  COLOR_SCHEME_COOKIE,
  parseApplicationSidebarCollapsed,
  parseColorScheme,
  parseOpen,
  parseSidebarCollapsed,
  PROFILES_COOKIE,
  SIDEBAR_COOKIE,
  STATUSES_COOKIE,
} from "@/lib/ui-preferences";
import { requestOrigin } from "@/lib/settings-views";
import { rememberBrowserTimeZone, rememberOrigin, userTimeZone } from "@/lib/time-zone";
import { checkForUpdatesDaily, updateNotice } from "@/lib/update-check";
import { askForUsagePing, notePageLoad, USAGE_PING_HOST } from "@/lib/usage-ping";
import { appVersion } from "@/lib/version";

import { AnnouncementNotice } from "./announcement-notice";
import { Sidebar } from "./sidebar";
import { UsagePingDialog } from "./usage-ping-dialog";

/**
 * The signed-in shell: sidebar on the left, the screen on the right. Routes
 * outside the (app) group, such as /login, render without it. Every page
 * inside needs a session.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Proxy already redirects signed-out visitors; this is the check next to the data.
  await verifySession();
  // The day's usage ping and update check, if they haven't run yet: after the page, so they never slow one down.
  after(notePageLoad);
  after(checkForUpdatesDaily);
  // The browser's zone, for the inbox check, which runs without a request.
  const zone = await userTimeZone();
  after(() => rememberBrowserTimeZone(zone));
  // And its address, for the links in notifications (E26-1).
  const origin = await requestOrigin();
  after(() => rememberOrigin(origin));

  const [name, settings, jar] = await Promise.all([loadProfileName(), loadSettings(), cookies()]);
  // A fresh install starts with the setup guide, once (E21).
  if (settings.setupGuide === null && opensSetupGuide({ guide: null, name, applications: await prisma.application.count() })) redirect("/welcome");
  // The backend's notices, if it's time to ask (it costs a page nothing until then).
  after(() => checkAnnouncementsIfDue(settings));
  // The portal catalog, when a read is due (E23-2): at most once a day.
  after(readCatalogIfDue);
  const userName = name.trim() || "New user";
  const announcement = currentAnnouncement(settings);
  // Replies waiting for an answer or a link, on the Inbox item; the job agent's finds and drafts on its own (E16-6).
  const [waiting, agent, installed, byStatus, profiles] = await Promise.all([
    inboxCount().catch(() => 0),
    countAgentQueue().catch(() => 0),
    loadInstalledPortals(),
    // The statuses under Applications (E27-4): archived ones and agent drafts awaiting review don't count.
    prisma.application.groupBy({ by: ["status"], where: { archivedAt: null, awaitingReview: false }, _count: { _all: true } }),
    // Each profile with its strength (E27-5).
    loadSidebarProfiles(),
  ]);
  const statusCounts = new Map(byStatus.map((group) => [group.status, group._count._all]));

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="fixed top-3 left-3 z-50 -translate-y-[200%] rounded-control bg-primary px-4 py-2.5 text-sm font-medium text-on-primary hover:text-on-primary focus:translate-y-0"
      >
        Skip to content
      </a>
      <Sidebar
        userName={userName}
        update={updateNotice(settings)}
        currentVersion={appVersion}
        desktop={isDesktopApp()}
        collapsed={parseSidebarCollapsed(jar.get(SIDEBAR_COOKIE)?.value)}
        applicationCollapsed={parseApplicationSidebarCollapsed(jar.get(APPLICATION_SIDEBAR_COOKIE)?.value)}
        counts={{ ...(waiting > 0 ? { "/inbox": waiting } : {}), ...(agent > 0 ? { "/agent": agent } : {}) }}
        applications={{
          total: [...statusCounts.values()].reduce((sum, count) => sum + count, 0),
          statuses: sidebarStatuses(statusCounts),
          open: parseOpen(jar.get(STATUSES_COOKIE)?.value),
        }}
        profiles={{ profiles, openId: settings.openProfileId ?? "", expanded: parseOpen(jar.get(PROFILES_COOKIE)?.value) }}
        colorScheme={parseColorScheme(jar.get(COLOR_SCHEME_COOKIE)?.value)}
      />
      {/* The screen sits in a white panel inset from the shell. Each screen
          starts with its page bar (PageHeader or PageBar), which draws the
          panel's top edge and stays in view. */}
      <div className="flex min-w-0 flex-1 flex-col bg-paper px-2 pb-2">
        <main
          id="main"
          tabIndex={-1}
          className="relative flex min-w-0 flex-1 flex-col rounded-b-panel border border-t-0 border-line-card bg-surface focus:outline-none"
        >
          {/* The portals the user added, known to every screen (E23-3). */}
          <PortalRegistry portals={installed.map((portal) => portalInfo(portal.config))}>{children}</PortalRegistry>
        </main>
      </div>
      {/* A new notice starts over, once the one before was dismissed. */}
      {announcement && <AnnouncementNotice key={announcement.id} announcement={announcement} />}
      {/* Asked once, until answered (#172); nothing is sent before a yes. It waits while the setup guide is open. */}
      {askForUsagePing(settings) && !setupInProgress(settings.setupGuide) && <UsagePingDialog host={USAGE_PING_HOST} />}
    </div>
  );
}
