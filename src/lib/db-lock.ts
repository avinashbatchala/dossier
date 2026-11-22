import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { usesSqlite } from "@/lib/database";

/**
 * Makes transactions that take the same key wait for each other (public PR
 * 61's job agent locks): a transaction-scoped advisory lock on PostgreSQL. On
 * SQLite there's nothing to take, since Prisma's adapter runs one
 * transaction at a time on its one connection (DEVELOPMENT.md, SQLite).
 */
export async function lockForTransaction(tx: Prisma.TransactionClient, key: number): Promise<void> {
  if (usesSqlite()) return;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key}::bigint)::text`;
}
