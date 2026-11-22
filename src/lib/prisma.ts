import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/database";
import { env } from "@/lib/env";

// Reuse one client across hot reloads in development instead of opening a new
// connection pool on every change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(env.DATABASE_URL);
  return globalForPrisma.prisma;
}

/**
 * The shared database client. It's created on first use rather than on
 * import, so `next build`, which imports every page, works without the
 * secrets that reading `env` requires.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, key) {
    const target = client();
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});
