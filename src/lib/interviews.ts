import "server-only";

import { upcomingRound } from "@/lib/interview-rounds";
import { prisma } from "@/lib/prisma";

export { prepSchema, upcomingRound } from "@/lib/interview-rounds";

// An application's interviews, a round each (E30-6, decided 17 November):
// setting the interview date, by hand or from the calendar event, fills the
// upcoming round; once it's past, it's in "So far", and "Add the next round"
// starts another. Application.nextInterviewAt stays the upcoming date that
// the dashboard, the flag and the calendar sync read.

export type RoundDetails = { minutes?: number | null; place?: string; people?: string };

/**
 * The upcoming round gets the interview date (and, from the calendar, its
 * length, place and people), as does a past round with that same date.
 * Otherwise a date starts the next round; no date and no upcoming round
 * changes nothing.
 */
export async function setUpcomingInterview(applicationId: string, at: Date | null, details: RoundDetails = {}, now = new Date()): Promise<void> {
  const rounds = await prisma.interview.findMany({ where: { applicationId }, select: { id: true, round: true, at: true, minutes: true, place: true, people: true }, orderBy: { round: "asc" } });
  const upcoming = upcomingRound(rounds, now);
  // From the calendar, only what it says; what was typed in stays otherwise.
  const filled = {
    ...(details.minutes ? { minutes: details.minutes } : {}),
    ...(details.place ? { place: details.place } : {}),
    ...(details.people ? { people: details.people } : {}),
  };
  // The same date again (e.g. the calendar read once more after the interview) is that round, not a new one.
  const same = at ? rounds.findLast((round) => round.at?.getTime() === at.getTime()) : undefined;
  const target = upcoming ?? same;
  if (target) {
    await prisma.interview.update({ where: { id: target.id }, data: { at, ...filled } });
    return;
  }
  if (!at) return;
  await prisma.interview.create({ data: { applicationId, round: (rounds.at(-1)?.round ?? 0) + 1, at, ...filled } });
}

/** "Add the next round": a round without a date yet, once every round is past. Returns it, or null while one is still to come. */
export async function addNextRound(applicationId: string, now = new Date()): Promise<{ id: string; round: number } | null> {
  const rounds = await prisma.interview.findMany({ where: { applicationId }, select: { id: true, round: true, at: true }, orderBy: { round: "asc" } });
  if (upcomingRound(rounds, now)) return null;
  return prisma.interview.create({ data: { applicationId, round: (rounds.at(-1)?.round ?? 0) + 1 }, select: { id: true, round: true } });
}
