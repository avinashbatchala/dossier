import "server-only";

import type { DashboardPeriod } from "@/lib/dashboard";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";

import { usageFigures, usageSince, type UsageEntry, type UsageFigures } from "./usage";

/**
 * Keeps one answered request's tokens (#290). Resolves either way: a count
 * that can't be written is logged, and never fails the request that used it.
 */
export async function recordUsage({ task, provider, model, input, output }: UsageEntry): Promise<void> {
  try {
    await prisma.aiUsage.create({ data: { task, provider, model, inputTokens: input, outputTokens: output } });
  } catch (error) {
    logServerError("Usage", error);
  }
}

/** The Usage screen's figures for `period`, and when counting started, if it has. */
export async function loadUsage(period: DashboardPeriod, now = new Date()): Promise<{ figures: UsageFigures; countingSince: Date | null }> {
  const since = usageSince(period, now);
  const [groups, first] = await Promise.all([
    prisma.aiUsage.groupBy({
      by: ["task"],
      where: since ? { createdAt: { gte: since } } : {},
      // Counting a column counts the rows where it isn't null: the requests whose server reported it.
      _count: { _all: true, inputTokens: true, outputTokens: true },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    prisma.aiUsage.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return {
    figures: usageFigures(
      groups.map(({ task, _count, _sum }) => ({
        task,
        requests: _count._all,
        inputRequests: _count.inputTokens,
        input: _sum.inputTokens ?? 0,
        outputRequests: _count.outputTokens,
        output: _sum.outputTokens ?? 0,
      })),
    ),
    countingSince: first?.createdAt ?? null,
  };
}
