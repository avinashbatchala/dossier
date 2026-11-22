import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaClient as SqliteClient } from "@/generated/prisma-sqlite/client";

// Dossier keeps its data in PostgreSQL, or in an SQLite file when
// DATABASE_URL is one ("file:/data/dossier.db"), for a single container
// without a database server. The SQLite schema is made from the PostgreSQL
// one (prisma/sqlite), so both clients have the same models, and the code
// uses the PostgreSQL client's types for both.

/** Whether `url` names an SQLite file rather than a PostgreSQL server. */
export function isSqliteUrl(url: string): boolean {
  return url.startsWith("file:");
}

/** Whether this server keeps its data in SQLite: what DATABASE_URL says, as the app, the desktop app and each test run set it. */
export const usesSqlite = (): boolean => isSqliteUrl(process.env.DATABASE_URL ?? "");

/** A client for the database at `url`. */
export function createPrismaClient(url: string): PrismaClient {
  if (!isSqliteUrl(url)) return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return new SqliteClient({ adapter: new OneAtATime({ url }) }) as unknown as PrismaClient;
}

type Adapter = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;

/**
 * better-sqlite3 has a single connection, and Prisma's adapter only makes
 * transactions wait for each other: a query from elsewhere while one is open
 * would run inside it, and be undone with it. Here every query waits until
 * the open transaction has ended.
 */
class OneAtATime extends PrismaBetterSqlite3 {
  async connect(): Promise<Adapter> {
    const adapter = await super.connect();
    let last = Promise.resolve();
    /** Waits for the turns before; returns what ends this one. */
    const turn = async () => {
      const before = last;
      let end!: () => void;
      last = new Promise((resolve) => (end = resolve));
      await before;
      return end;
    };
    const alone =
      <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
      async (...args: A) => {
        const end = await turn();
        try {
          return await call(...args);
        } finally {
          end();
        }
      };

    return Object.assign(Object.create(adapter), {
      queryRaw: alone(adapter.queryRaw.bind(adapter)),
      executeRaw: alone(adapter.executeRaw.bind(adapter)),
      executeScript: alone(adapter.executeScript.bind(adapter)),
      async startTransaction(...args: Parameters<Adapter["startTransaction"]>) {
        const end = await turn();
        try {
          const transaction = await adapter.startTransaction(...args);
          const ending = (call: () => Promise<void>) => async () => {
            try {
              await call();
            } finally {
              end();
            }
          };
          return Object.assign(Object.create(transaction), {
            commit: ending(() => transaction.commit()),
            rollback: ending(() => transaction.rollback()),
          });
        } catch (error) {
          end();
          throw error;
        }
      },
    } satisfies Partial<Adapter>);
  }
}
