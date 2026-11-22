import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient, isSqliteUrl } from "@/lib/database";

/**
 * The database for `*.db.test.ts` files: TEST_DATABASE_URL, or DATABASE_URL
 * with "_test" added to the database name (or the SQLite file's, before its
 * extension). Refuses any database whose name doesn't end in "_test", so
 * tests can never wipe development data.
 */
export function testDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!explicit && !base) {
    throw new Error("Database tests need DATABASE_URL or TEST_DATABASE_URL.");
  }
  if (isSqliteUrl(explicit ?? base!)) {
    const url = explicit ?? base!.replace(/(\.\w+)?$/, "_test$1");
    if (!/_test(\.\w+)?$/.test(url)) throw new Error(`Refusing to run database tests against "${url}": its name must end in "_test".`);
    return url;
  }
  const url = new URL(explicit ?? base!);
  if (!explicit) url.pathname = `${url.pathname}_test`;
  if (!url.pathname.endsWith("_test")) {
    throw new Error(`Refusing to run database tests against "${url.pathname.slice(1)}": its name must end in "_test".`);
  }
  return url.toString();
}

/** Whether the tests run against SQLite rather than PostgreSQL. */
export function testsUseSqlite(): boolean {
  return isSqliteUrl(testDatabaseUrl());
}

export function createTestClient(): PrismaClient {
  return createPrismaClient(testDatabaseUrl());
}

/** The profile a migrated database starts with (the profiles migration's id, E24-1). */
export const TEST_PROFILE_ID = "first";

/**
 * Empties every table, so each test starts from a blank database: one empty
 * profile, as after the migrations, with its levels chosen (E24-3), so
 * scoring can go ahead; a test of the wait for them clears them.
 */
export async function resetDatabase(db: PrismaClient): Promise<void> {
  await emptyTables(db);
  await db.profile.create({ data: { id: TEST_PROFILE_ID, name: "My profile", levelFrom: "mid", levelTo: "senior" } });
}

async function emptyTables(db: PrismaClient): Promise<void> {
  if (testsUseSqlite()) {
    const tables = await db.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'`;
    // SQLite has no TRUNCATE … CASCADE: the order doesn't matter with the checks off.
    await db.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    // Built-in themes can't be deleted (see the init migration's trigger).
    await db.$executeRawUnsafe(`UPDATE "Theme" SET "builtIn" = false`);
    for (const { name } of tables) await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
    await db.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    return;
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map(({ tablename }) => `"${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}
