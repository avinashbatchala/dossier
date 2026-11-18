import type { PrismaClient } from "@/generated/prisma/client";
import { BUILT_IN_THEMES } from "@/lib/themes";

/**
 * Creates what every installation needs: the built-in themes. Safe to run on
 * every start: they're kept in sync with BUILT_IN_THEMES (src/lib/themes.ts).
 * An empty profile and default settings need no rows.
 */
export async function seedBuiltIns(db: PrismaClient): Promise<void> {
  await db.$transaction(
    BUILT_IN_THEMES.map(({ id, ...theme }) =>
      db.theme.upsert({ where: { id }, create: { id, ...theme }, update: theme }),
    ),
    // Prisma waits 2 s for a connection by default; a busy database (a full e2e run) needed longer.
    { maxWait: 10_000 },
  );
}
