import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { searchQuerySchema } from "@/lib/job-search/search";
import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";

import { agentSearchInputSchema, MAX_AGENT_SEARCHES, type AgentSearchInput, type SavedAgentSearch } from "./search";

/** Serialize all search writes, including imports, without introducing a lock table. */
export async function lockAgentSearches(tx: Prisma.TransactionClient): Promise<void> {
  await lockForTransaction(tx, 621746001);
}

export async function listAgentSearches(db: PrismaClient = prisma): Promise<SavedAgentSearch[]> {
  const rows = await db.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  return rows.map((row) => ({ ...row, query: searchQuerySchema.parse(row.query) }));
}

/** Create, or update by stable id. Disabled searches count toward the cap too. */
export async function saveAgentSearch(input: AgentSearchInput, id?: string, db: PrismaClient = prisma): Promise<SavedAgentSearch> {
  const parsed = agentSearchInputSchema.parse(input);
  return db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    // A profile deleted meanwhile reads as the first (E24-6).
    const data = { ...parsed, profileId: parsed.profileId && (await tx.profile.findUnique({ where: { id: parsed.profileId }, select: { id: true } })) ? parsed.profileId : null };
    if (id && !await tx.agentSearch.findUnique({ where: { id }, select: { id: true } })) throw new ActionError("That Agent search no longer exists.");
    if (!id && await tx.agentSearch.count() >= MAX_AGENT_SEARCHES) throw new ActionError("Keep at most three Agent searches.");
    const row = id
      ? await tx.agentSearch.update({ where: { id }, data })
      : await tx.agentSearch.create({ data });
    return { ...row, query: searchQuerySchema.parse(row.query) };
  });
}

/** A stale toggle must never replace another tab's name, query or order. */
export async function setAgentSearchEnabled(id: string, enabled: boolean, db: PrismaClient = prisma): Promise<SavedAgentSearch> {
  return db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    const current = await tx.agentSearch.findUnique({ where: { id } });
    if (!current) throw new ActionError("That Agent search no longer exists.");
    const query = searchQuerySchema.parse(current.query);
    if (enabled && !query.country) throw new ActionError(`Choose a country for “${current.name}”.`);
    const row = await tx.agentSearch.update({ where: { id }, data: { enabled } });
    return { ...row, query };
  });
}

/** The FK unlinks attribution but keeps its historical name. Candidates remain. */
export async function deleteAgentSearch(id: string, db: PrismaClient = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    await tx.agentSearch.deleteMany({ where: { id } });
  });
}

/** Move against the current order under the same lock as create/delete/import. */
export async function moveAgentSearch(id: string, direction: "up" | "down", db: PrismaClient = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await lockAgentSearches(tx);
    const rows = await tx.agentSearch.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) throw new ActionError("That Agent search no longer exists.");
    const target = index + (direction === "up" ? -1 : 1);
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    for (const [sort, row] of rows.entries()) await tx.agentSearch.update({ where: { id: row.id }, data: { sort } });
  });
}
