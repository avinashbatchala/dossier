import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { settingsFromRows, settingValue, type SettingsData } from "@/lib/settings";

/** The settings in effect. Each profile's Base resume settings are its own (src/lib/profiles.ts). */
export async function loadSettings(db: PrismaClient | Prisma.TransactionClient = prisma): Promise<SettingsData> {
  return settingsFromRows(await db.setting.findMany());
}

/**
 * Saves the given settings together; null removes one, so it reads as not
 * set. Pass a transaction client to save them as part of that transaction.
 */
export async function saveSettings(changes: Partial<SettingsData>, db?: Prisma.TransactionClient): Promise<void> {
  if (!db) return prisma.$transaction((tx) => saveSettings(changes, tx));
  for (const [key, change] of Object.entries(changes)) {
    if (change === undefined) continue;
    const value = settingValue(change);
    if (value === null) await db.setting.deleteMany({ where: { key } });
    else await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}
