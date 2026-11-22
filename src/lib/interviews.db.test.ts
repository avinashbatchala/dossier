import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { addNextRound, setUpcomingInterview, upcomingRound } from "./interviews";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const now = new Date("2026-11-17T10:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
const rounds = () => prisma().interview.findMany({ where: { applicationId: "app-1" }, orderBy: { round: "asc" }, select: { round: true, at: true, minutes: true, place: true, people: true } });

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", company: "Ledgerly", profileId: TEST_PROFILE_ID } });
});
afterAll(() => prisma().$disconnect());

describe("upcomingRound (E30-6)", () => {
  it("is the last round while it has no date or its date is ahead", () => {
    expect(upcomingRound([{ id: "a", round: 1, at: day(-3) }, { id: "b", round: 2, at: day(2) }], now)?.id).toBe("b");
    expect(upcomingRound([{ id: "a", round: 1, at: day(-3) }, { id: "b", round: 2, at: null }], now)?.id).toBe("b");
    expect(upcomingRound([{ id: "a", round: 1, at: day(-3) }], now)).toBeNull();
  });
});

describe("setUpcomingInterview (E30-6)", () => {
  it("starts round 1 with the date, then moves it, and starts round 2 once round 1 is past", async () => {
    await setUpcomingInterview("app-1", day(2), {}, now);
    await setUpcomingInterview("app-1", day(3), { minutes: 45, place: "Google Meet", people: "Lotte de Vries" }, now);
    expect(await rounds()).toEqual([{ round: 1, at: day(3), minutes: 45, place: "Google Meet", people: "Lotte de Vries" }]);

    const later = day(5);
    await setUpcomingInterview("app-1", day(9), {}, later);
    expect((await rounds()).map((round) => [round.round, round.at])).toEqual([
      [1, day(3)],
      [2, day(9)],
    ]);
  });

  it("keeps what was typed in when the calendar says nothing, and reads the same past date as that round", async () => {
    await prisma().interview.create({ data: { applicationId: "app-1", round: 1, at: day(-1), place: "Their office" } });
    await setUpcomingInterview("app-1", day(-1), { minutes: 60, place: "" }, now);
    expect(await rounds()).toEqual([{ round: 1, at: day(-1), minutes: 60, place: "Their office", people: "" }]);
  });

  it("clears the upcoming round's date, and does nothing without one", async () => {
    await setUpcomingInterview("app-1", null, {}, now);
    expect(await rounds()).toEqual([]);
    await setUpcomingInterview("app-1", day(2), {}, now);
    await setUpcomingInterview("app-1", null, {}, now);
    expect((await rounds()).map((round) => round.at)).toEqual([null]);
  });
});

describe("addNextRound (E30-6)", () => {
  it("adds a round without a date once every round is past, and not while one is to come", async () => {
    await prisma().interview.create({ data: { applicationId: "app-1", round: 1, at: day(-2) } });
    expect(await addNextRound("app-1", now)).toMatchObject({ round: 2 });
    expect(await addNextRound("app-1", now)).toBeNull();
    expect((await rounds()).map((round) => round.round)).toEqual([1, 2]);
  });
});
