import "server-only";

import { stat, unlink } from "node:fs/promises";
import path from "node:path";

import { backupsDir, listBackups, writeBackup } from "@/lib/backups";
import { env } from "@/lib/env";
import { logServerError } from "@/lib/log";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Nightly backups (E10-7, SET-10): while "Nightly backups" is on, an export
// is written at 03:00 server time, and backups older than
// DOSSIER_BACKUP_RETENTION_DAYS are removed. A plain timer in this process,
// so it's only safe with a single instance of the app (E12-5). A computer
// that's off at 03:00, as the desktop app's often is, gets the backup soon
// after Dossier starts, once the last one is over a day old (#325).

const HOUR = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after the start a missed backup waits, so it doesn't slow the first pages. */
const CATCH_UP_AFTER_MS = 15_000;

/** The next 03:00 in the server's time zone after `now`. */
export function nextRun(now: Date): Date {
  const next = new Date(now);
  next.setHours(HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

/** Deletes backups older than the retention; returns how many went. */
export async function pruneBackups(now: Date, days = env.DOSSIER_BACKUP_RETENTION_DAYS): Promise<number> {
  const cutoff = now.getTime() - days * DAY_MS;
  const old = (await listBackups()).filter((backup) => backup.modified.getTime() < cutoff);
  await Promise.all(old.map((backup) => unlink(path.join(backupsDir(), backup.name)).catch(() => {})));
  return old.length;
}

/**
 * One night's run: a backup if they're on, then tidying up. A failure is
 * kept in Settings, so the row can show it, and cleared by the next success.
 */
export async function runNightlyBackup(now = new Date()): Promise<"written" | "off"> {
  if (!(await loadSettings()).nightlyBackup) return "off";
  try {
    await writeBackup("nightly", now);
    await pruneBackups(now);
    await saveSettings({ backupProblem: null });
    return "written";
  } catch (error) {
    logServerError("nightly backup", error);
    await saveSettings({ backupProblem: error instanceof Error ? error.message : "The backup couldn't be written." }).catch(() => {});
    throw error;
  }
}

/** When the newest nightly backup was written, if any. */
export async function lastNightlyBackup(): Promise<Date | null> {
  const [latest] = (await listBackups()).filter((backup) => backup.name.startsWith("dossier-backup-nightly-"));
  if (!latest) return null;
  return (await stat(path.join(backupsDir(), latest.name)).catch(() => null))?.mtime ?? null;
}

/** At the start: the backup the last night missed, when the newest is over a day old or there's none. */
export async function catchUpBackup(now = new Date()): Promise<"written" | "off" | "recent"> {
  if (!(await loadSettings()).nightlyBackup) return "off";
  const last = await lastNightlyBackup();
  if (last && now.getTime() - last.getTime() < DAY_MS) return "recent";
  return runNightlyBackup(now);
}

const globalForSchedule = globalThis as unknown as { backupTimer?: ReturnType<typeof setTimeout> };

/** Starts the nightly timer, once per process (dev reloads keep the one they have). */
export function startBackupSchedule(): void {
  if (globalForSchedule.backupTimer) return;
  const schedule = () => {
    const now = new Date();
    globalForSchedule.backupTimer = setTimeout(() => {
      void runNightlyBackup()
        .catch(() => {})
        .finally(schedule);
    }, nextRun(now).getTime() - now.getTime());
    // Don't keep the process alive just for this.
    globalForSchedule.backupTimer.unref?.();
  };
  schedule();
  setTimeout(() => void catchUpBackup().catch(() => {}), CATCH_UP_AFTER_MS).unref?.();
}
