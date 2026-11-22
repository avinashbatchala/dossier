import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import { afterFailure, GLOBAL, PER_IP, type ThrottlePolicy, type ThrottleState, waitMs } from "./throttle";

// Rate limiting for sign-in (PRD AUTH-5), stored in the database so limits
// survive restarts without Redis. An attempt counts for the client's IP and
// for everyone together (the key "*"), or, from a browser that signed in
// before (known-browser.ts), for the IP and that browser: the limit on
// everyone mustn't keep the person's own browser out (#334). It counts
// before the password is checked: counted after the check, a burst of
// attempts would all get past the limit before the first of them was
// counted (#329).

export const GLOBAL_KEY = "*";
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

/** An IP's row, which an address sent as "*" can't turn into the global one. */
export const ipKey = (ip: string) => `ip:${ip}`;
/** The row of a browser that signed in before. */
export const browserKey = (id: string) => `browser:${id}`;

type Tx = Prisma.TransactionClient;

/** Who's trying to sign in: the client's IP, and the browser's id when it signed in here before. */
export type LoginClient = { ip: string; browser: string | null };

/** A sign-in attempt that was let through to the password check. */
export type AllowedAttempt = {
  allowed: true;
  /** Call once the password was right: resets the IP's counter and takes this attempt back from the global one. */
  succeeded: () => Promise<void>;
};

/**
 * A sign-in attempt that was refused before the password was checked:
 * "client" when this IP or browser tried too often, "everyone" when only the
 * limit on everyone together stopped it.
 */
export type RefusedAttempt = { allowed: false; waitMs: number; limit: "client" | "everyone" };

/**
 * Counts a sign-in attempt, unless one of its limits is blocked, in one
 * transaction, so attempts made at the same time take turns. A wrong password
 * needs nothing more: its attempt is already counted.
 */
export async function startLoginAttempt(
  db: PrismaClient,
  client: LoginClient,
  now = new Date(),
): Promise<AllowedAttempt | RefusedAttempt> {
  const counted = await db.$transaction(async (tx) => {
    // Always the IP first, then the other row, so concurrent attempts can't deadlock.
    const rows: { key: string; policy: ThrottlePolicy; state: ThrottleState | null }[] = [];
    for (const [key, policy] of limitsOf(client)) {
      rows.push({ key, policy, state: await lockedRow(tx, key, now) });
    }

    const waits = rows.map(({ key, state }) => ({ key, wait: waitMs(state, now) }));
    const wait = Math.max(...waits.map((row) => row.wait));
    if (wait > 0) {
      const limit = waits.some((row) => row.key !== GLOBAL_KEY && row.wait > 0) ? "client" : "everyone";
      return { wait, limit, global: null } as const;
    }

    let global: Change | null = null;
    for (const { key, policy, state } of rows) {
      const next = afterFailure(state, now, policy);
      await tx.loginThrottle.update({ where: { key }, data: { ...next, updatedAt: now } });
      if (key === GLOBAL_KEY) global = { before: state, after: next };
    }
    await tx.loginThrottle.deleteMany({
      where: { updatedAt: { lt: new Date(now.getTime() - PRUNE_AFTER_MS) } },
    });
    return { wait: 0, limit: null, global };
  });

  if (counted.limit) return { allowed: false, waitMs: counted.wait, limit: counted.limit };
  return { allowed: true, succeeded: () => takeBack(db, client, counted.global, now) };
}

/** Restarting Dossier lifts a block on everyone, for when no known browser is at hand (#334). */
export async function liftBlockOnEveryone(db: PrismaClient): Promise<void> {
  await db.loginThrottle.deleteMany({ where: { key: GLOBAL_KEY } });
}

function limitsOf({ ip, browser }: LoginClient): [string, ThrottlePolicy][] {
  return [[ipKey(ip), PER_IP], browser ? [browserKey(browser), PER_IP] : [GLOBAL_KEY, GLOBAL]];
}

/** What counting an attempt did to a row. */
type Change = { before: ThrottleState | null; after: ThrottleState };

/**
 * The row for `key`, created when there's none, and locked with a write that
 * changes nothing, so concurrent attempts take turns (in PostgreSQL and SQLite
 * alike). Null while it holds no failures.
 */
async function lockedRow(tx: Tx, key: string, now: Date): Promise<ThrottleState | null> {
  await tx.$executeRaw`
    INSERT INTO "LoginThrottle" (key, "windowStart", "updatedAt")
    VALUES (${key}, ${now}, ${now})
    ON CONFLICT (key) DO UPDATE SET key = excluded.key`;
  const row = await tx.loginThrottle.findUniqueOrThrow({
    where: { key },
    select: { failures: true, windowStart: true, blockedUntil: true },
  });
  return row.failures === 0 ? null : row;
}

/**
 * After the right password: the IP and the browser start over, and the global
 * count goes back to what it was before this attempt. When other attempts came
 * in since, it's only one fewer, and a block they started stays.
 */
async function takeBack(db: PrismaClient, client: LoginClient, global: Change | null, now: Date): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.loginThrottle.deleteMany({ where: { key: { in: limitsOf(client).map(([key]) => key).filter((key) => key !== GLOBAL_KEY) } } });
    if (!global) return;
    await tx.$executeRaw`UPDATE "LoginThrottle" SET key = key WHERE key = ${GLOBAL_KEY}`;
    const row = await tx.loginThrottle.findUnique({
      where: { key: GLOBAL_KEY },
      select: { failures: true, windowStart: true, blockedUntil: true },
    });
    if (!row || row.failures === 0) return;
    const restored = sameState(row, global.after)
      ? (global.before ?? { failures: 0, windowStart: row.windowStart, blockedUntil: null })
      : { ...row, failures: row.failures - 1 };
    await tx.loginThrottle.update({ where: { key: GLOBAL_KEY }, data: { ...restored, updatedAt: now } });
  });
}

function sameState(a: ThrottleState, b: ThrottleState): boolean {
  return (
    a.failures === b.failures &&
    a.windowStart.getTime() === b.windowStart.getTime() &&
    (a.blockedUntil?.getTime() ?? null) === (b.blockedUntil?.getTime() ?? null)
  );
}
