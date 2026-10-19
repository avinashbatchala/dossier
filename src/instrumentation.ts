// Next.js calls register() once when a server starts, before it handles any
// request. It doesn't run during `next build`, so the build needs no secrets.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkEnvOnStartup } = await import("@/lib/env");
    checkEnvOnStartup();

    // AI jobs left running by the previous process can't finish (E6-7).
    const { recoverInterruptedJobs } = await import("@/lib/jobs/runner");
    const { logServerError } = await import("@/lib/log");
    await recoverInterruptedJobs().catch((error: unknown) => logServerError("startup", error));

    // Finished jobs, with what they were given and wrote, are deleted after a while.
    const { startJobSweep } = await import("@/lib/jobs/retention");
    startJobSweep();

    // Nightly backups at 03:00, while they're switched on (E10-7).
    const { startBackupSchedule } = await import("@/lib/backup-schedule");
    startBackupSchedule();

    // The inbox check, while a Google account is connected (E15-3).
    const { startInboxSchedule } = await import("@/lib/google/sync");
    startInboxSchedule();

    // Says what the usage ping sends and how to stop it, while it's on.
    const { USAGE_PING_NOTICE, usagePingEnabled } = await import("@/lib/usage-ping");
    if (usagePingEnabled()) console.log(USAGE_PING_NOTICE);
  }
}
