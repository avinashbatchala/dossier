// Next.js calls register() once when a server starts, before it handles any
// request. It doesn't run during `next build`, so the build needs no secrets.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnStartup } = await import("@/lib/env");
    checkEnvOnStartup();

    const { logServerError } = await import("@/lib/log");

    // A restart lifts a block on sign-ins from new browsers (#334).
    const { liftBlockOnEveryone } = await import("@/lib/auth/login-throttle");
    const { prisma } = await import("@/lib/prisma");
    await liftBlockOnEveryone(prisma).catch((error: unknown) => logServerError("startup", error));

    // AI jobs left running by the previous process can't finish (E6-7).
    const { recoverInterruptedJobs } = await import("@/lib/jobs/runner");
    await recoverInterruptedJobs().catch((error: unknown) => logServerError("startup", error));

    // Applications sent before 1.12 keep what they show now (#299).
    const { freezeSentApplications } = await import("@/lib/frozen-copy");
    await freezeSentApplications().catch((error: unknown) => logServerError("startup", error));

    // Finished jobs, with what they were given and wrote, are deleted after a while.
    const { startJobSweep } = await import("@/lib/jobs/retention");
    startJobSweep();

    // Nightly backups at 03:00, while they're switched on (E10-7).
    const { startBackupSchedule } = await import("@/lib/backup-schedule");
    startBackupSchedule();

    // The inbox check, while a Google account is connected (E15-3).
    const { startInboxSchedule } = await import("@/lib/google/sync");
    startInboxSchedule();

    // The job agent's daily run, while it's on (E16-4).
    const { startAgentSchedule } = await import("@/lib/agent/schedule");
    startAgentSchedule();

    // Notifications' deliveries that are due, every minute (E26-1).
    const { startNotificationSchedule } = await import("@/lib/notifications/notify");
    startNotificationSchedule();
    // And the daily check at 18:00 in the user's zone: interview tomorrow, follow-ups due, a new version (E26-7).
    const { startDailyNotificationCheck } = await import("@/lib/notifications/daily");
    startDailyNotificationCheck();

    // Startups' daily refresh, once it was refreshed by hand and while the screen is in use (#222).
    const { startStartupsSchedule } = await import("@/lib/startups/schedule");
    startStartupsSchedule();

    // DOSSIER_JOBS_SOURCE=arbeitsagentur: the log says what that choice means (#223).
    // And, once, the job search settings from before E22-3 move into the portals' shape.
    const { arbeitsagenturStartupNotice, loadJobSearchConfig, moveJobSettings } = await import("@/lib/job-search/config");
    try {
      // The portals the user added, known from the start (E23-3).
      const { loadInstalledPortals } = await import("@/lib/portals/installed");
      await loadInstalledPortals();
      if (await moveJobSettings()) console.log("Job search: moved the saved source and keys into Settings → Job search's portals.");
      // And what past searches kept as JSON, into the positions library (E22-5).
      const { fillMatchKeys, movePastSearches } = await import("@/lib/library");
      const moved = await movePastSearches();
      // And postings from before E22-6 get the company key a new one is compared by.
      await fillMatchKeys();
      // Agent candidates kept before coverage get theirs (E32-2).
      const { fillCandidateCoverage } = await import("@/lib/agent/fill-coverage");
      await fillCandidateCoverage();
      // And what the job agent found before E22-8 joins them, once.
      const { moveAgentFinds } = await import("@/lib/agent/move-in");
      const agentFinds = await moveAgentFinds();
      if (agentFinds > 0) console.log(`Job agent: moved ${agentFinds} postings it found into Positions.`);
      // Then, every hour, untouched postings move to the Archive (E22-7).
      const { startArchiveSchedule } = await import("@/lib/archive");
      startArchiveSchedule();
      if (moved > 0) console.log(`Job search: moved ${moved} past searches' postings into Positions.`);
      const notice = arbeitsagenturStartupNotice(await loadJobSearchConfig());
      if (notice) console.log(notice);
    } catch (error) {
      logServerError("job search", error);
    }

    // DOSSIER_TELEMETRY, when set, is the usage ping's answer on record (#172).
    // Then the log says what the ping sends while it's on, or how to answer
    // while nobody has.
    const { recordEnvChoice, usagePingNotice } = await import("@/lib/usage-ping");
    const { loadSettings } = await import("@/lib/settings-data");
    try {
      await recordEnvChoice();
      const notice = usagePingNotice(await loadSettings());
      if (notice) console.log(notice);
    } catch (error) {
      logServerError("usage ping", error);
    }
  }
}
